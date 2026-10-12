import { and, asc, eq, sql } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { importMappings, type ImportMappingEntry } from "../../drizzle/schema/importMappings.js";
import { users } from "../../drizzle/schema/users.js";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { resolveTarget } from "./targetAccess.js";

interface Actor {
  id: number;
  roleName: string | null;
  department: string | null;
}

async function who(db: Db, userId: number): Promise<{ label: string; when: string }> {
  const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId));
  const [profile] = await db.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = profile?.profile?.timezone || "UTC";
  const when = new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(new Date());
  return { label: formatUserLabel(person ? { ...person, isActive: person.isActive ?? true } : undefined, userId), when };
}

async function findDuplicate(db: Db, targetRef: string, fileKind: string, name: string, excludeId?: number) {
  const rows = await db
    .select()
    .from(importMappings)
    .where(and(eq(importMappings.targetRef, targetRef), eq(importMappings.fileKind, fileKind), sql`lower(${importMappings.name}) = lower(${name})`));
  return rows.find((row) => row.id !== excludeId) ?? null;
}

export async function listMappings(db: Db, actor: Actor, targetRef: string) {
  await resolveTarget(db, actor, targetRef);
  return db.select().from(importMappings).where(eq(importMappings.targetRef, targetRef)).orderBy(asc(importMappings.name));
}

export async function saveMapping(
  db: Db,
  actor: Actor,
  input: { targetRef: string; fileKind: string; name: string; entries: Record<string, ImportMappingEntry> },
) {
  const target = await resolveTarget(db, actor, input.targetRef);
  if (!target.canEdit) throw AppError.forbidden("You can't save a mapping for this form.");
  const name = input.name.trim();
  if (!name) throw AppError.badRequest("Name the mapping.");
  const duplicate = await findDuplicate(db, input.targetRef, input.fileKind, name);
  if (duplicate) throw new AppError(`A mapping named "${name}" already exists for this form.`, 409);
  const [created] = await db
    .insert(importMappings)
    .values({ targetRef: input.targetRef, fileKind: input.fileKind, name, entries: input.entries, createdBy: actor.id, updatedBy: actor.id })
    .returning();
  if (!created) throw new Error("Could not save the mapping");
  const person = await who(db, actor.id);
  await recordAuditTrail(db, {
    entityType: "ImportMapping",
    entityId: created.id,
    action: "create",
    changes: { summary: `${person.label} saved import mapping "${name}" for "${target.title}" (${Object.keys(input.entries).length} fields) on ${person.when}.` },
    performedBy: actor.id,
  });
  return created;
}

export async function updateMapping(db: Db, actor: Actor, id: number, input: { name?: string; entries?: Record<string, ImportMappingEntry> }) {
  const [current] = await db.select().from(importMappings).where(eq(importMappings.id, id));
  if (!current) throw AppError.notFound("Mapping");
  const target = await resolveTarget(db, actor, current.targetRef);
  if (!target.canEdit) throw AppError.forbidden("You can't change this mapping.");
  const nextName = input.name !== undefined ? input.name.trim() : current.name;
  if (!nextName) throw AppError.badRequest("Name the mapping.");
  if (input.name !== undefined && nextName.toLowerCase() !== current.name.toLowerCase()) {
    const duplicate = await findDuplicate(db, current.targetRef, current.fileKind, nextName, id);
    if (duplicate) throw new AppError(`A mapping named "${nextName}" already exists for this form.`, 409);
  }
  const [updated] = await db
    .update(importMappings)
    .set({ name: nextName, entries: input.entries ?? current.entries, updatedBy: actor.id, updatedAt: new Date() })
    .where(eq(importMappings.id, id))
    .returning();
  if (!updated) throw new Error("Could not update the mapping");
  const person = await who(db, actor.id);
  const summary =
    input.name !== undefined && nextName !== current.name
      ? `${person.label} renamed import mapping "${current.name}" to "${nextName}" for "${target.title}" on ${person.when}.`
      : `${person.label} updated import mapping "${nextName}" for "${target.title}" on ${person.when}.`;
  await recordAuditTrail(db, {
    entityType: "ImportMapping",
    entityId: id,
    action: "update",
    changes: { summary },
    performedBy: actor.id,
  });
  return updated;
}

export async function deleteMapping(db: Db, actor: Actor, id: number) {
  const [current] = await db.select().from(importMappings).where(eq(importMappings.id, id));
  if (!current) throw AppError.notFound("Mapping");
  const target = await resolveTarget(db, actor, current.targetRef);
  if (!target.canEdit) throw AppError.forbidden("You can't delete this mapping.");
  await db.delete(importMappings).where(eq(importMappings.id, id));
  const person = await who(db, actor.id);
  await recordAuditTrail(db, {
    entityType: "ImportMapping",
    entityId: id,
    action: "delete",
    changes: { summary: `${person.label} deleted import mapping "${current.name}" for "${target.title}" on ${person.when}.` },
    performedBy: actor.id,
  });
}
