import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { AppError } from "../../utils/appError.js";
import { attachFieldChanges, labelPersonFields, resolveUserNames, withResolvedActors } from "./audit-trail.service.js";
import { canSeeCompanyAuditRow, filterCompanyAuditBySite, visibleEntityTypes } from "./auditTrailVisibility.js";

type Viewer = { id: number; roleName: string | null; department: string | null };

export interface AuditListQuery {
  userId?: number;
  /** Inclusive, YYYY-MM-DD. */
  from?: string;
  /** Inclusive, YYYY-MM-DD. */
  to?: string;
  entityType?: string;
  /** Searches the action and the logged description/details. */
  q?: string;
  limit: number;
  /** Return only rows older than this id. */
  before?: number;
}

export const AUDIT_PAGE_DEFAULT = 50;
export const AUDIT_PAGE_MAX = 200;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function dayStart(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

function nextDay(value: string): Date {
  const date = dayStart(value);
  date.setUTCDate(date.getUTCDate() + 1);
  return date;
}

export function parseAuditListQuery(raw: Record<string, unknown>): AuditListQuery {
  const str = (key: string) => (typeof raw[key] === "string" && (raw[key] as string).trim() !== "" ? (raw[key] as string).trim() : undefined);
  const int = (key: string) => {
    const value = str(key);
    if (value === undefined) return undefined;
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1) throw AppError.badRequest(`"${key}" must be a whole number.`);
    return n;
  };
  const from = str("from");
  const to = str("to");
  if ((from && !DATE.test(from)) || (to && !DATE.test(to))) throw AppError.badRequest("Dates must look like 2026-10-31.");
  if (from && to && from > to) throw AppError.badRequest("The start date is after the end date.");
  const q = str("q");
  return {
    userId: int("userId"),
    from,
    to,
    entityType: str("entityType"),
    q: q ? q.slice(0, 100) : undefined,
    limit: Math.min(int("limit") ?? AUDIT_PAGE_DEFAULT, AUDIT_PAGE_MAX),
    before: int("before"),
  };
}

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/** What this person may see, as SQL. Mirrors canSeeCompanyAuditRow: another person's sign-in and account rows stay with an owner or administrator. */
function visibilityCondition(visible: Set<string> | "all", viewerId: number): SQL | undefined {
  if (visible === "all") return undefined;
  const own = and(eq(auditTrail.entityType, "User"), eq(auditTrail.entityId, viewerId));
  const types = [...visible];
  return types.length === 0 ? own : or(inArray(auditTrail.entityType, types), own);
}

function filterConditions(query: AuditListQuery, visible: Set<string> | "all", viewerId: number): SQL[] {
  const conds: (SQL | undefined)[] = [visibilityCondition(visible, viewerId)];
  if (query.userId) conds.push(eq(auditTrail.performedBy, query.userId));
  if (query.from) conds.push(gte(auditTrail.createdAt, dayStart(query.from)));
  if (query.to) conds.push(lt(auditTrail.createdAt, nextDay(query.to)));
  if (query.entityType) conds.push(eq(auditTrail.entityType, query.entityType));
  if (query.q) {
    const like = `%${escapeLike(query.q)}%`;
    conds.push(or(sql`${auditTrail.action} ILIKE ${like}`, sql`${auditTrail.changes}::text ILIKE ${like}`));
  }
  return conds.filter((cond): cond is SQL => cond !== undefined);
}

/**
 * One page of the company audit log, newest first, with the filters applied in the
 * database. Rows are read in batches (older than `before`) and the same visibility and
 * plant checks as the unfiltered list are applied, so a filter can never reveal a row
 * the person could not already see. `nextBefore` is the cursor for the next, older page.
 */
export async function listCompanyAudit(db: Db, viewer: Viewer, allowedSiteIds: number[] | undefined, query: AuditListQuery) {
  const visible = await visibleEntityTypes(db, viewer);
  const base = filterConditions(query, visible, viewer.id);
  const collected: (typeof auditTrail.$inferSelect)[] = [];
  let cursor = query.before;
  let exhausted = false;

  for (let pass = 0; pass < 20 && collected.length <= query.limit && !exhausted; pass += 1) {
    const conds = cursor ? [...base, lt(auditTrail.id, cursor)] : base;
    const batch = await db
      .select()
      .from(auditTrail)
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(auditTrail.id))
      .limit(query.limit * 3);
    if (batch.length === 0) {
      exhausted = true;
      break;
    }
    cursor = batch[batch.length - 1]!.id;
    if (batch.length < query.limit * 3) exhausted = true;
    const byType = batch.filter((row) => canSeeCompanyAuditRow(visible, row, viewer.id));
    const onPlant = await filterCompanyAuditBySite(db, byType, viewer, allowedSiteIds);
    collected.push(...onPlant);
  }

  const page = collected.slice(0, query.limit);
  let nextBefore: number | null = null;
  if (collected.length > query.limit) nextBefore = page[page.length - 1]!.id;
  else if (!exhausted && cursor) nextBefore = cursor;
  const withActors = await withResolvedActors(db, page);
  const withFields = await attachFieldChanges(db, withActors);
  const rows = await labelPersonFields(db, withFields);
  return { rows, nextBefore };
}

/** Record types and people that appear in the log this person is allowed to see, for the filter drop-downs. */
export async function auditFilterOptions(db: Db, viewer: Viewer) {
  const visible = await visibleEntityTypes(db, viewer);
  const cond = visibilityCondition(visible, viewer.id);
  const types = await db.selectDistinct({ entityType: auditTrail.entityType }).from(auditTrail).where(cond);
  const performers = await db.selectDistinct({ id: auditTrail.performedBy }).from(auditTrail).where(cond);
  const names = await resolveUserNames(db, performers.map((row) => row.id));
  return {
    entityTypes: types.map((row) => row.entityType).sort((a, b) => a.localeCompare(b)),
    users: [...names.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}
