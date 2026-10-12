import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { FAI_SCHEDULE_MANAGE_PERMISSION, FAI_VIEW_PERMISSION } from "../roles/roleAccess.js";
import { inspApprovedSources, inspPlans, inspRecords } from "../../drizzle/schema/faiInspection.js";
import { faiRandomPullBatches, faiRandomPullItems, faiRandomPullRules } from "../../drizzle/schema/faiScheduling.js";
import { addMonths, isoToday } from "./fai-due-status.js";
import { pickTarget, randomSample, type PickRulesInput } from "./fai-random-pick.js";
import { deny } from "./fai-inspection.service.js";
import { notifyRandomPullApproved } from "./fai-notifications.service.js";

const ENTITY = "FAI Random Pull";

async function requirePerm(db: Db, user: any, permission: string, what: string) {
  const roleName = user?.role ?? user?.roleName;
  const allowed = await roleHasPermission(db, roleName, permission);
  if (!allowed) await deny(db, user, permission, what);
}

/* ---------------- Rules (one row; created lazily) ---------------- */

async function ensureRules(db: Db) {
  const [existing] = await db.select().from(faiRandomPullRules).orderBy(asc(faiRandomPullRules.id)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(faiRandomPullRules).values({ pickMode: "percent", pickPercent: 10, excludeMonths: 6 }).returning();
  return created!;
}

export async function getRules(db: Db, user: any) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view random-pull rules");
  return ensureRules(db);
}

export async function updateRules(db: Db, user: any, input: any) {
  await requirePerm(db, user, FAI_SCHEDULE_MANAGE_PERMISSION, "edit random-pull rules");
  const current = await ensureRules(db);
  const patch: any = { updatedAt: new Date(), updatedBy: user?.id ?? null };
  for (const k of ["pickMode", "pickPercent", "pickCount", "productFamily", "riskClass", "siteId", "excludeMonths"] as const) {
    if (input[k] !== undefined) patch[k] = input[k] ?? null;
  }
  const [updated] = await db.update(faiRandomPullRules).set(patch).where(eq(faiRandomPullRules.id, current.id)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: current.id, action: "update",
    changes: { what: "random-pull rules", description: "Updated the annual random-pull rules." },
    performedBy: user?.id ?? null,
  });
  return updated;
}

/* ---------------- Eligibility + generate ---------------- */

/**
 * Approved sources eligible for this year's pull: Approved only, the rules' optional
 * product-family/risk-class/plant filters (borrowed from any inspection plan sharing the
 * same part number — insp_approved_sources has no plan link of its own), not FAI'd in
 * the last excludeMonths, and not already picked into an APPROVED batch this year (so
 * clicking "Generate" twice in a year doesn't double-pick the same source — see the
 * PR description for why this isn't spelled out in the Phase 2 prompt itself).
 */
async function eligibleSourceIds(db: Db, rules: { productFamily: string | null; riskClass: string | null; siteId: number | null; excludeMonths: number }, year: number): Promise<number[]> {
  const cutoff = addMonths(isoToday(), -rules.excludeMonths);
  const conds = [eq(inspApprovedSources.status, "approved")];
  if (rules.siteId) conds.push(eq(inspApprovedSources.siteId, rules.siteId));

  const rows = await db
    .select({ id: inspApprovedSources.id, partNumber: inspApprovedSources.partNumber, lastFaiDate: inspApprovedSources.lastFaiDate })
    .from(inspApprovedSources)
    .where(and(...conds));

  let candidateIds = rows.filter((r) => !r.lastFaiDate || r.lastFaiDate < cutoff).map((r) => ({ id: r.id, partNumber: r.partNumber }));

  if (rules.productFamily || rules.riskClass) {
    const planConds = [];
    if (rules.productFamily) planConds.push(eq(inspPlans.productFamily, rules.productFamily));
    if (rules.riskClass) planConds.push(eq(inspPlans.riskClass, rules.riskClass));
    const matchingParts = new Set((await db.select({ partNumber: inspPlans.partNumber }).from(inspPlans).where(and(...planConds))).map((p) => p.partNumber));
    candidateIds = candidateIds.filter((c) => matchingParts.has(c.partNumber));
  }

  if (candidateIds.length === 0) return [];
  const alreadyPicked = new Set(
    (await db
      .select({ sourceId: faiRandomPullItems.sourceId })
      .from(faiRandomPullItems)
      .innerJoin(faiRandomPullBatches, eq(faiRandomPullBatches.id, faiRandomPullItems.batchId))
      .where(and(eq(faiRandomPullBatches.year, year), eq(faiRandomPullBatches.status, "approved"))))
      .map((r) => r.sourceId),
  );
  return candidateIds.filter((c) => !alreadyPicked.has(c.id)).map((c) => c.id);
}

export async function generateBatch(db: Db, user: any, input: { year?: number }) {
  await requirePerm(db, user, FAI_SCHEDULE_MANAGE_PERMISSION, "generate a random-pull list");
  const rules = await ensureRules(db);
  const year = input.year ?? new Date().getFullYear();
  const pool = await eligibleSourceIds(db, rules, year);
  const target = pickTarget(rules as PickRulesInput, pool.length);
  const picked = randomSample(pool, target);

  const [inserted] = await db
    .insert(faiRandomPullBatches)
    .values({ year, rulesSnapshot: rules, status: "pending_approval", generatedBy: user?.id ?? null })
    .returning();
  const batch = inserted!;
  for (const sourceId of picked) {
    await db.insert(faiRandomPullItems).values({ batchId: batch.id, sourceId });
  }
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: batch.id, action: "create",
    changes: { what: "random-pull pick list", description: `Generated a ${year} random-pull list of ${picked.length} source(s) from ${pool.length} eligible, pending approval.` },
    performedBy: user?.id ?? null,
  });
  return getBatch(db, user, batch.id);
}

/* ---------------- Batches + items ---------------- */

async function sourceLabel(db: Db, sourceId: number) {
  const [s] = await db.select().from(inspApprovedSources).where(eq(inspApprovedSources.id, sourceId));
  return s;
}

async function itemsFor(db: Db, batchId: number) {
  const items = await db.select().from(faiRandomPullItems).where(eq(faiRandomPullItems.batchId, batchId)).orderBy(asc(faiRandomPullItems.id));
  const sourceIds = items.map((i: any) => i.sourceId);
  const sources = sourceIds.length ? await db.select().from(inspApprovedSources).where(inArray(inspApprovedSources.id, sourceIds)) : [];
  const sourceById = new Map(sources.map((s: any) => [s.id, s]));
  const recordIds = items.map((i: any) => i.linkedRecordId).filter((id: number | null): id is number => id != null);
  const records = recordIds.length ? await db.select().from(inspRecords).where(inArray(inspRecords.id, recordIds)) : [];
  const recordById = new Map(records.map((r: any) => [r.id, r]));
  return items.map((item: any) => {
    const source = sourceById.get(item.sourceId);
    const record = item.linkedRecordId ? recordById.get(item.linkedRecordId) : null;
    const status: "pending" | "linked" | "completed_pass" | "completed_fail" = !record ? "pending" : record.status === "passed" ? "completed_pass" : record.status === "failed" ? "completed_fail" : "linked";
    return {
      id: item.id,
      batchId: item.batchId,
      sourceId: item.sourceId,
      partNumber: source?.partNumber ?? null,
      supplierFactory: source?.supplierFactory ?? null,
      receivingLocation: source?.receivingLocation ?? null,
      siteId: source?.siteId ?? null,
      linkedRecordId: item.linkedRecordId,
      linkedFaiNumber: record?.faiNumber ?? null,
      status,
    };
  });
}

export async function listBatches(db: Db, user: any, year?: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view random-pull batches");
  const conds = year ? [eq(faiRandomPullBatches.year, year)] : [];
  return db.select().from(faiRandomPullBatches).where(conds.length ? and(...conds) : undefined).orderBy(desc(faiRandomPullBatches.generatedAt));
}

export async function getBatch(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view a random-pull batch");
  const [batch] = await db.select().from(faiRandomPullBatches).where(eq(faiRandomPullBatches.id, id));
  if (!batch) throw AppError.notFound("Random-pull batch not found.");
  const items = await itemsFor(db, id);
  return { ...batch, items };
}

export async function approveBatch(db: Db, user: any, req: any, id: number, input: any) {
  await requirePerm(db, user, FAI_SCHEDULE_MANAGE_PERMISSION, "approve a random-pull list");
  const [batch] = await db.select().from(faiRandomPullBatches).where(eq(faiRandomPullBatches.id, id));
  if (!batch) throw AppError.notFound("Random-pull batch not found.");
  if (batch.status === "approved") throw new AppError("This pick list is already approved.", 409);
  const stamp = await requireSignatureStamp(req, {
    pin: input.pin, certified: input.certified,
    entityType: ENTITY, entityId: id, field: "approval", description: input.description,
  });
  const [updated] = await db.update(faiRandomPullBatches).set({
    status: "approved", approvedBy: user?.id ?? null, approvedAt: new Date(), approvalSignature: stamp.stamp,
  }).where(eq(faiRandomPullBatches.id, id)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "status_change",
    changes: { what: "random-pull approval", description: `Approved the ${batch.year} random-pull list, signed by ${stamp.stamp}.` },
    performedBy: user?.id ?? null,
  });
  const result = await getBatch(db, user, updated!.id);
  await notifyRandomPullApproved(db, { id: result.id, year: result.year }, result.items);
  return result;
}

/** Called right after the user creates the FAI record from this item (trigger reason "Annual random pull"). */
export async function linkItemToRecord(db: Db, user: any, itemId: number, recordId: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "link a random-pull item");
  const [item] = await db.select().from(faiRandomPullItems).where(eq(faiRandomPullItems.id, itemId));
  if (!item) throw AppError.notFound("Random-pull item not found.");
  const [record] = await db.select().from(inspRecords).where(eq(inspRecords.id, recordId));
  if (!record) throw AppError.notFound("FAI record not found.");
  const [updated] = await db.update(faiRandomPullItems).set({ linkedRecordId: recordId }).where(eq(faiRandomPullItems.id, itemId)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: item.batchId, action: "update",
    changes: { what: "random-pull item linked", description: `Linked random-pull item (source #${item.sourceId}) to FAI record ${record.faiNumber}.` },
    performedBy: user?.id ?? null,
  });
  return updated;
}

/* ---------------- Year-end compliance ---------------- */

export async function compliance(db: Db, user: any, year: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view random-pull compliance");
  const batches = await db.select({ id: faiRandomPullBatches.id }).from(faiRandomPullBatches).where(and(eq(faiRandomPullBatches.year, year), eq(faiRandomPullBatches.status, "approved")));
  const batchIds = batches.map((b: any) => b.id);
  if (batchIds.length === 0) return { year, picked: 0, completed: 0, overdue: 0 };
  const items = await Promise.all(batchIds.map((id: number) => itemsFor(db, id)));
  const flat = items.flat();
  const isPastYear = year < new Date().getFullYear();
  const completed = flat.filter((i) => i.status === "completed_pass" || i.status === "completed_fail").length;
  const overdue = isPastYear ? flat.filter((i) => i.status === "pending" || i.status === "linked").length : 0;
  return { year, picked: flat.length, completed, overdue };
}

export { ensureRules };
