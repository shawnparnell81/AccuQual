import { asc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

/**
 * On the first save, this account is placed first. Everyone else keeps
 * the order they already had (lowest id first, which is how the rows were stored).
 */
export const INITIAL_LEAD_EMAIL = "admin@accuqualqms.com";

/** A missing role sorts after every ranked role, including a custom rank of 1000. */
const UNRANKED = 1_000_000;

export interface SortablePerson {
  id: number;
  name: string;
  roleRank: number | null;
}

export function storedUserDisplayOrder(profile: { userDisplayOrder?: unknown } | null | undefined): number[] | null {
  const value = profile?.userDisplayOrder;
  if (!Array.isArray(value)) return null;
  const ids: number[] = [];
  for (const id of value) {
    if (typeof id === "number" && Number.isInteger(id) && id > 0) ids.push(id);
  }
  return ids;
}

/**
 * Ordered ids stay in the saved sequence. Everyone else follows, by role
 * rank (smaller is higher), then name, then id.
 */
export function compareDisplayOrder(a: SortablePerson, b: SortablePerson, indexOf: Map<number, number>): number {
  const aIndex = indexOf.get(a.id);
  const bIndex = indexOf.get(b.id);
  if (aIndex !== undefined && bIndex !== undefined) return aIndex - bIndex;
  if (aIndex !== undefined) return -1;
  if (bIndex !== undefined) return 1;
  const rankA = a.roleRank ?? UNRANKED;
  const rankB = b.roleRank ?? UNRANKED;
  if (rankA !== rankB) return rankA - rankB;
  const byName = a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
  if (byName !== 0) return byName;
  return a.id - b.id;
}

export function orderPeople<T>(rows: readonly T[], order: readonly number[], describe: (row: T) => SortablePerson): T[] {
  const indexOf = new Map<number, number>();
  order.forEach((id, index) => {
    if (!indexOf.has(id)) indexOf.set(id, index);
  });
  return [...rows].sort((a, b) => compareDisplayOrder(describe(a), describe(b), indexOf));
}

export function initialUserDisplayOrder(rows: readonly { id: number; email: string }[]): { userIds: number[]; leadPlacedFirst: boolean } {
  const sorted = [...rows].sort((a, b) => a.id - b.id);
  const leadIndex = sorted.findIndex((row) => row.email.trim().toLowerCase() === INITIAL_LEAD_EMAIL);
  if (leadIndex > 0) {
    const [lead] = sorted.splice(leadIndex, 1);
    sorted.unshift(lead!);
  }
  return { userIds: sorted.map((row) => row.id), leadPlacedFirst: leadIndex >= 0 };
}

/** The person an administrator moved, when the request did not name one. */
export function movedPerson(before: readonly number[], after: readonly number[]): number | null {
  let bestId: number | null = null;
  let bestDelta = -1;
  after.forEach((id, index) => {
    const from = before.indexOf(id);
    if (from < 0 || from === index) return;
    const delta = Math.abs(index - from);
    if (delta > bestDelta) {
      bestId = id;
      bestDelta = delta;
    }
  });
  return bestId;
}

export function displayName(name: string | null | undefined, email: string | null | undefined): string {
  const trimmed = name?.trim();
  if (trimmed) return trimmed;
  return email?.trim() ?? "";
}

/** Reads the saved order. The first read stores id order, with the lead account first when that account exists. */
export async function loadUserDisplayOrder(db: Db, performedBy?: number): Promise<number[]> {
  const [co] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  if (!co) return [];
  const existing = storedUserDisplayOrder(co.profile);
  if (existing) return existing;

  const people = await db.select({ id: users.id, email: users.email }).from(users).orderBy(asc(users.id));
  const initial = initialUserDisplayOrder(people);
  await db.update(company).set({ profile: { ...co.profile, userDisplayOrder: initial.userIds } }).where(eq(company.id, co.id));
  await recordAuditTrail(db, {
    entityType: "Company",
    entityId: co.id,
    action: "update",
    changes: {
      action: "user_display_order_initialized",
      system: true,
      userIds: initial.userIds,
      leadPlacedFirst: initial.leadPlacedFirst,
    },
    performedBy,
  });
  return initial.userIds;
}

async function roleRanksFor(db: Db, ids: number[]): Promise<Map<number, number | null>> {
  if (ids.length === 0) return new Map();
  const rows = await db
    .select({ id: users.id, rank: roles.hierarchyLevel })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(inArray(users.id, ids));
  return new Map(rows.map((row) => [row.id, row.rank]));
}

/** Same order for every directory: saved sequence, then role rank, then name. */
export async function sortByDisplayOrder<T>(
  db: Db,
  rows: readonly T[],
  idOf: (row: T) => number,
  nameOf: (row: T) => string,
  performedBy?: number,
  rankOf?: (row: T) => number | null | undefined,
): Promise<T[]> {
  const order = await loadUserDisplayOrder(db, performedBy);
  const ranks = rankOf ? null : await roleRanksFor(db, rows.map(idOf));
  return orderPeople(rows, order, (row) => ({
    id: idOf(row),
    name: nameOf(row),
    roleRank: rankOf ? (rankOf(row) ?? null) : (ranks!.get(idOf(row)) ?? null),
  }));
}

export async function saveUserDisplayOrder(
  db: Db,
  userIds: number[],
  performedBy: number | undefined,
  move: { movedUserId: number; movedUserName: string; fromPosition: number; toPosition: number } | null,
): Promise<void> {
  const [co] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  if (!co) return;
  await db.update(company).set({ profile: { ...co.profile, userDisplayOrder: userIds } }).where(eq(company.id, co.id));
  if (!move || move.fromPosition === move.toPosition) return;
  await recordAuditTrail(db, {
    entityType: "Company",
    entityId: co.id,
    action: "update",
    changes: {
      action: "user_display_order",
      movedUserId: move.movedUserId,
      movedUserName: move.movedUserName,
      fromIndex: move.fromPosition,
      toIndex: move.toPosition,
      userIds,
    },
    performedBy,
  });
}
