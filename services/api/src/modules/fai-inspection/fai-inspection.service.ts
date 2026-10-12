import { and, asc, desc, eq, like, or, sql } from "drizzle-orm";
import { AppError } from "../../utils/appError.js";
import { pool } from "../../db/index.js";
import { recordAuditTrail, recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import {
  FAI_CREATE_PERMISSION, FAI_DELETE_PERMISSION, FAI_EDIT_PERMISSION,
  FAI_SIGNOFF_PERMISSION, FAI_VIEW_PERMISSION, FAI_PLANS_MANAGE_PERMISSION,
} from "../roles/roleAccess.js";
import { inspPlans, inspPlanCharacteristics, inspApprovedSources, inspRecords, inspResultLines } from "../../drizzle/schema/faiInspection.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { ISO_DOCUMENTS_FOLDER } from "../document-folders/formFiling.js";
import { aqlLookup } from "./aql.js";
import { calcLimits, judgeLine, type LimitType } from "./fai-inspection.logic.js";

type Db = any;

const ENTITY = "FAI Inspection";

async function deny(db: Db, user: any, permission: string, what: string) {
  await recordAuditTrailStandalone(pool, {
    entityType: ENTITY,
    entityId: 0,
    action: "permission_denied",
    changes: { permission, description: `User lacks ${permission}: ${what}` },
    performedBy: user?.id ?? null,
  });
  throw AppError.forbidden(`You don't have permission to ${what}.`);
}

async function requirePerm(db: Db, user: any, permission: string, what: string) {
  const roleName = user?.role ?? user?.roleName;
  const allowed = await roleHasPermission(db, roleName, permission);
  if (!allowed) await deny(db, user, permission, what);
}

function siteFilter(db: Db, table: any, siteId: number | null) {
  return siteId ? eq(table.siteId, siteId) : undefined;
}

/* ---------------- Plans ---------------- */

export async function listPlans(db: Db, user: any, siteId: number | null, q?: string) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view inspection plans");
  const conds = [siteFilter(db, inspPlans, siteId)].filter(Boolean);
  if (q) conds.push(or(like(inspPlans.partNumber, `%${q}%`), like(inspPlans.partDescription, `%${q}%`))!);
  return db.select().from(inspPlans).where(conds.length ? and(...conds) : undefined).orderBy(desc(inspPlans.updatedAt));
}

export async function getPlan(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view inspection plan");
  const [plan] = await db.select().from(inspPlans).where(eq(inspPlans.id, id));
  if (!plan) throw AppError.notFound("Inspection plan not found.");
  const chars = await db.select().from(inspPlanCharacteristics)
    .where(and(eq(inspPlanCharacteristics.planId, id), eq(inspPlanCharacteristics.revision, plan.revision)))
    .orderBy(asc(inspPlanCharacteristics.sortOrder));
  return { ...plan, characteristics: chars };
}

export async function createPlan(db: Db, user: any, siteId: number | null, input: any) {
  await requirePerm(db, user, FAI_PLANS_MANAGE_PERMISSION, "create inspection plans");
  const [plan] = await db.insert(inspPlans).values({
    partNumber: input.partNumber,
    partDescription: input.partDescription ?? null,
    productFamily: input.productFamily ?? null,
    supplierId: input.supplierId ?? null,
    supplierFactory: input.supplierFactory ?? null,
    receivingLocation: input.receivingLocation ?? null,
    riskClass: input.riskClass ?? "Major",
    revision: 1,
    status: "Draft",
    repeatIntervalMonths: input.repeatIntervalMonths ?? 6,
    majorAql: input.majorAql ?? "1.0",
    minorAql: input.minorAql ?? "2.5",
    notes: input.notes ?? null,
    siteId,
    createdBy: user?.id ?? null,
  }).returning();
  for (const [i, c] of (input.characteristics ?? []).entries()) {
    await db.insert(inspPlanCharacteristics).values({
      planId: plan.id, revision: 1, sortOrder: c.sortOrder ?? i,
      name: c.name, charType: c.charType ?? "Major", limitType: c.limitType ?? "plus_minus",
      nominal: c.nominal ?? null, tolerancePlus: c.tolerancePlus ?? null, toleranceMinus: c.toleranceMinus ?? null,
      percent: c.percent ?? null, specMin: c.specMin ?? null, specMax: c.specMax ?? null,
      unit: c.unit ?? null, method: c.method ?? null,
    });
  }
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: plan.id, action: "create",
    changes: { what: "inspection plan", description: `Created inspection plan for part ${input.partNumber} (rev 1)` },
    performedBy: user?.id ?? null,
  });
  return plan;
}

function charsEqual(a: any[], b: any[]): boolean {
  if (a.length !== b.length) return false;
  const key = (c: any) => [c.name, c.charType, c.limitType, c.nominal, c.tolerancePlus, c.toleranceMinus, c.percent, c.specMin, c.specMax, c.unit, c.method].join("|");
  return a.map(key).join(";;") === b.map(key).join(";;");
}

export async function updatePlan(db: Db, user: any, id: number, input: any) {
  await requirePerm(db, user, FAI_PLANS_MANAGE_PERMISSION, "edit inspection plans");
  const [plan] = await db.select().from(inspPlans).where(eq(inspPlans.id, id));
  if (!plan) throw AppError.notFound("Inspection plan not found.");
  let revBumped = false;
  if (input.characteristics) {
    const existing = await db.select().from(inspPlanCharacteristics)
      .where(and(eq(inspPlanCharacteristics.planId, id), eq(inspPlanCharacteristics.revision, plan.revision)))
      .orderBy(asc(inspPlanCharacteristics.sortOrder));
    if (!charsEqual(existing, input.characteristics)) {
      // Structure changed -> new revision. Old revision rows stay immutable.
      const nextRev = plan.revision + 1;
      for (const [i, c] of input.characteristics.entries()) {
        await db.insert(inspPlanCharacteristics).values({
          planId: id, revision: nextRev, sortOrder: c.sortOrder ?? i,
          name: c.name, charType: c.charType ?? "Major", limitType: c.limitType ?? "plus_minus",
          nominal: c.nominal ?? null, tolerancePlus: c.tolerancePlus ?? null, toleranceMinus: c.toleranceMinus ?? null,
          percent: c.percent ?? null, specMin: c.specMin ?? null, specMax: c.specMax ?? null,
          unit: c.unit ?? null, method: c.method ?? null,
        });
      }
      revBumped = true;
    }
  }
  const patch: any = { updatedAt: new Date() };
  if (revBumped) patch.revision = plan.revision + 1;
  for (const k of ["partNumber", "partDescription", "productFamily", "supplierId", "supplierFactory", "receivingLocation", "riskClass", "repeatIntervalMonths", "majorAql", "minorAql", "notes", "status"] as const) {
    if (input[k] !== undefined) patch[k] = input[k] ?? null;
  }
  const [updated] = await db.update(inspPlans).set(patch).where(eq(inspPlans.id, id)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "update",
    changes: { what: "inspection plan", description: `Updated inspection plan for part ${plan.partNumber}${revBumped ? ` (rev ${plan.revision} -> ${plan.revision + 1})` : ""}` },
    performedBy: user?.id ?? null,
  });
  return updated;
}

/* ---------------- Approved sources ---------------- */

export async function listSources(db: Db, user: any, siteId: number | null, status?: string) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view approved sources");
  const conds = [siteFilter(db, inspApprovedSources, siteId)].filter(Boolean);
  if (status) conds.push(eq(inspApprovedSources.status, status));
  return db.select().from(inspApprovedSources).where(conds.length ? and(...conds) : undefined).orderBy(asc(inspApprovedSources.nextDueDate));
}

export async function ensureSource(db: Db, args: {
  partNumber: string; supplierId?: number | null; supplierFactory?: string | null;
  receivingLocation?: string | null; siteId?: number | null;
}) {
  const [existing] = await db.select().from(inspApprovedSources).where(and(
    eq(inspApprovedSources.partNumber, args.partNumber),
    args.supplierId ? eq(inspApprovedSources.supplierId, args.supplierId) : sql`${inspApprovedSources.supplierId} IS NULL`,
    args.supplierFactory ? eq(inspApprovedSources.supplierFactory, args.supplierFactory) : sql`${inspApprovedSources.supplierFactory} IS NULL`,
    args.receivingLocation ? eq(inspApprovedSources.receivingLocation, args.receivingLocation) : sql`${inspApprovedSources.receivingLocation} IS NULL`,
  ));
  if (existing) return existing;
  const [row] = await db.insert(inspApprovedSources).values({
    partNumber: args.partNumber,
    supplierId: args.supplierId ?? null,
    supplierFactory: args.supplierFactory ?? null,
    receivingLocation: args.receivingLocation ?? null,
    status: "fai_required",
    siteId: args.siteId ?? null,
  }).returning();
  return row;
}

export async function manualSourceStatus(db: Db, user: any, req: any, id: number, input: any) {
  await requirePerm(db, user, FAI_SIGNOFF_PERMISSION, "change approved source status");
  const stamp = await requireSignatureStamp(req, {
    pin: input.pin, certified: input.certified,
    entityType: ENTITY, entityId: id, field: "source.status", description: input.description,
  });
  const [src] = await db.select().from(inspApprovedSources).where(eq(inspApprovedSources.id, id));
  if (!src) throw AppError.notFound("Approved source not found.");
  const [updated] = await db.update(inspApprovedSources)
    .set({ status: input.status, updatedAt: new Date() })
    .where(eq(inspApprovedSources.id, id)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "status_change",
    changes: {
      what: "approved source status", description: `Manually changed source ${src.partNumber} from ${src.status} to ${input.status}. Reason: ${input.reason}. Signed by ${stamp.stamp}`,
    },
    performedBy: user?.id ?? null,
  });
  return updated;
}

/* ---------------- Records ---------------- */

export async function listRecords(db: Db, user: any, siteId: number | null, filters: any) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view FAI records");
  const conds = [siteFilter(db, inspRecords, siteId)].filter(Boolean);
  if (filters.status) conds.push(eq(inspRecords.status, filters.status));
  if (filters.q) conds.push(or(like(inspRecords.faiNumber, `%${filters.q}%`), like(inspRecords.partNumber, `%${filters.q}%`))!);
  if (filters.dueSoon) {
    // dueSoon handled via sources; here filter by status only
  }
  return db.select().from(inspRecords).where(conds.length ? and(...conds) : undefined).orderBy(desc(inspRecords.createdAt));
}

export async function getRecord(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view FAI record");
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  const lines = await db.select().from(inspResultLines).where(eq(inspResultLines.recordId, id)).orderBy(asc(inspResultLines.sortOrder));
  return { ...rec, lines };
}

export async function createRecord(db: Db, user: any, siteId: number | null, input: any) {
  await requirePerm(db, user, FAI_CREATE_PERMISSION, "create FAI records");
  const [dup] = await db.select({ id: inspRecords.id }).from(inspRecords).where(eq(inspRecords.faiNumber, input.faiNumber.trim()));
  if (dup) throw new AppError(`FAI number "${input.faiNumber.trim()}" is already used. Enter a unique FAI number.`, 409);

  let plan: any = null;
  let chars: any[] = [];
  let planRevision: number | null = null;
  if (input.planId) {
    [plan] = await db.select().from(inspPlans).where(eq(inspPlans.id, input.planId));
    if (!plan) throw AppError.notFound("Inspection plan not found.");
    planRevision = plan.revision;
    chars = await db.select().from(inspPlanCharacteristics)
      .where(and(eq(inspPlanCharacteristics.planId, plan.id), eq(inspPlanCharacteristics.revision, plan.revision)))
      .orderBy(asc(inspPlanCharacteristics.sortOrder));
  }

  const majorAql = input.majorAql ?? plan?.majorAql ?? "1.0";
  const minorAql = input.minorAql ?? plan?.minorAql ?? "2.5";
  const level = input.inspectionLevel ?? "II";
  const severity = input.severity ?? "Normal";
  let aql: any = {};
  if (input.lotSize) {
    const mj = aqlLookup(input.lotSize, level, severity, majorAql);
    const mn = aqlLookup(input.lotSize, level, severity, minorAql);
    aql = {
      codeLetter: mj.codeLetter, aqlSampleSize: mj.sampleSize,
      acMajor: mj.ac, reMajor: mj.re, acMinor: mn.ac, reMinor: mn.re,
    };
  }

  const [rec] = await db.insert(inspRecords).values({
    faiNumber: input.faiNumber.trim(),
    planId: input.planId ?? null,
    planRevision,
    partNumber: input.partNumber.trim(),
    supplierId: input.supplierId ?? plan?.supplierId ?? null,
    supplierFactory: input.supplierFactory ?? plan?.supplierFactory ?? null,
    receivingLocation: input.receivingLocation ?? plan?.receivingLocation ?? null,
    triggerReason: input.triggerReason ?? null,
    poReference: input.poReference ?? null,
    lotSize: input.lotSize ?? null,
    sampleSize: aql.aqlSampleSize ?? null,
    inspector: input.inspector ?? null,
    datePulled: input.datePulled ?? null,
    dateLabReceived: input.dateLabReceived ?? null,
    dateInspected: input.dateInspected ?? null,
    status: "draft",
    inspectionLevel: level,
    severity,
    majorAql, minorAql,
    ...aql,
    linkedCsaFaiId: input.linkedCsaFaiId ?? null,
    linkedFuelPumpFaiId: input.linkedFuelPumpFaiId ?? null,
    comments: input.comments ?? null,
    siteId,
    createdBy: user?.id ?? null,
  }).returning();

  // Copy characteristics as result lines with calculated limits SAVED.
  for (const [i, c] of chars.entries()) {
    const [low, high] = calcLimits({
      limitType: c.limitType as LimitType,
      nominal: c.nominal, tolerancePlus: c.tolerancePlus, toleranceMinus: c.toleranceMinus,
      percent: c.percent, specMin: c.specMin, specMax: c.specMax,
    });
    await db.insert(inspResultLines).values({
      recordId: rec.id, sortOrder: c.sortOrder ?? i,
      characteristicName: c.name, charType: c.charType, limitType: c.limitType,
      nominal: c.nominal, tolerancePlus: c.tolerancePlus, toleranceMinus: c.toleranceMinus,
      percent: c.percent, specMin: c.specMin, specMax: c.specMax,
      unit: c.unit, method: c.method,
      limitLow: low, limitHigh: high,
    });
  }

  await ensureSource(db, {
    partNumber: rec.partNumber, supplierId: rec.supplierId,
    supplierFactory: rec.supplierFactory, receivingLocation: rec.receivingLocation, siteId,
  });

  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: rec.id, action: "create",
    changes: { what: "FAI record", description: `Created FAI record ${rec.faiNumber} for part ${rec.partNumber}` },
    performedBy: user?.id ?? null,
  });
  await fileRecordInFolder(db, user, rec);
  return rec;
}

export async function updateRecord(db: Db, user: any, id: number, input: any) {
  await requirePerm(db, user, FAI_EDIT_PERMISSION, "edit FAI records");
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  if (["passed", "failed", "cancelled"].includes(rec.status)) throw new AppError("Signed or cancelled records cannot be edited.");
  const patch: any = { updatedAt: new Date() };
  for (const k of ["partNumber", "supplierId", "supplierFactory", "receivingLocation", "triggerReason", "poReference", "lotSize", "inspector", "datePulled", "dateLabReceived", "dateInspected", "inspectionLevel", "severity", "majorAql", "minorAql", "linkedCsaFaiId", "linkedFuelPumpFaiId", "comments", "status"] as const) {
    if (input[k] !== undefined) patch[k] = input[k] ?? null;
  }
  // Re-run AQL lookup if lot size / level / severity / AQL changed.
  const lotSize = patch.lotSize ?? rec.lotSize;
  if (lotSize && (input.lotSize !== undefined || input.inspectionLevel !== undefined || input.severity !== undefined || input.majorAql !== undefined || input.minorAql !== undefined)) {
    const level = patch.inspectionLevel ?? rec.inspectionLevel ?? "II";
    const severity = patch.severity ?? rec.severity ?? "Normal";
    const mj = aqlLookup(lotSize, level, severity, patch.majorAql ?? rec.majorAql ?? "1.0");
    const mn = aqlLookup(lotSize, level, severity, patch.minorAql ?? rec.minorAql ?? "2.5");
    Object.assign(patch, { codeLetter: mj.codeLetter, aqlSampleSize: mj.sampleSize, sampleSize: mj.sampleSize, acMajor: mj.ac, reMajor: mj.re, acMinor: mn.ac, reMinor: mn.re });
  }
  const [updated] = await db.update(inspRecords).set(patch).where(eq(inspRecords.id, id)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "update",
    changes: { what: "FAI record", description: `Updated FAI record ${rec.faiNumber}` },
    performedBy: user?.id ?? null,
  });
  return updated;
}

export async function saveResultLines(db: Db, user: any, id: number, lines: any[]) {
  await requirePerm(db, user, FAI_EDIT_PERMISSION, "enter inspection results");
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  if (["passed", "failed", "cancelled"].includes(rec.status)) throw new AppError("Signed or cancelled records cannot be edited.");
  const existing = await db.select().from(inspResultLines).where(eq(inspResultLines.recordId, id));
  for (const line of lines) {
    const row = existing.find((r: any) => r.id === line.id);
    if (!row) continue;
    const result = judgeLine({
      limitType: row.limitType as LimitType, limitLow: row.limitLow, limitHigh: row.limitHigh,
      measuredValue: line.measuredValue ?? null, attributeResult: line.attributeResult ?? null,
    });
    await db.update(inspResultLines).set({
      measuredValue: line.measuredValue ?? null,
      attributeResult: line.attributeResult ?? null,
      defects: line.defects ?? 0,
      result: result ?? row.result,
    }).where(eq(inspResultLines.id, row.id));
  }
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "update",
    changes: { what: "inspection results", description: `Saved inspection results on FAI record ${rec.faiNumber}` },
    performedBy: user?.id ?? null,
  });
  return getRecord(db, user, id);
}

export async function deleteRecord(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_DELETE_PERMISSION, "delete FAI records");
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  await db.delete(inspResultLines).where(eq(inspResultLines.recordId, id));
  await db.delete(inspRecords).where(eq(inspRecords.id, id));
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "delete",
    changes: { what: "FAI record", description: `Deleted FAI record ${rec.faiNumber} for part ${rec.partNumber}` },
    performedBy: user?.id ?? null,
  });
  return { ok: true };
}

function addMonths(dateStr: string, months: number): string {
  const d = new Date(dateStr + "T00:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

/** Ensure ISO Compliance Documents > Test Data Projects > FAI exists; file the record there. */
async function fileRecordInFolder(db: Db, user: any, rec: any) {
  const all = await db.select().from(documentFolders);
  const iso = all.find((r: any) => r.parentId == null && r.name === ISO_DOCUMENTS_FOLDER);
  if (!iso) return;
  let parent: any = iso;
  for (const name of ["Test Data Projects", "FAI"]) {
    let child = all.find((r: any) => r.parentId === parent.id && r.name === name);
    if (!child) {
      const siblings = all.filter((r: any) => r.parentId === parent.id);
      const [created] = await db.insert(documentFolders).values({
        name, parentId: parent.id, sortOrder: siblings.length,
        linkedPath: `/fai-inspection/records/${rec.id}`,
      }).returning();
      if (!created) return;
      all.push(created);
      child = created;
      await recordAuditTrail(db, {
        entityType: "DocumentFolder", entityId: created.id, action: "create",
        changes: { description: `Created folder "${name}" for FAI records.` },
        performedBy: user?.id ?? null,
      });
    }
    parent = child;
  }
}

export async function signRecord(db: Db, user: any, req: any, id: number, input: any) {
  await requirePerm(db, user, FAI_SIGNOFF_PERMISSION, "sign off FAI records");
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  if (!["draft", "in_inspection", "awaiting_signoff"].includes(rec.status)) throw new AppError("Record is already signed or cancelled.");
  const stamp = await requireSignatureStamp(req, {
    pin: input.pin, certified: input.certified,
    entityType: ENTITY, entityId: id, field: "signoff", description: input.description,
  });
  const outcome = input.outcome; // passed | failed
  const [updated] = await db.update(inspRecords).set({
    status: outcome, overallResult: outcome,
    signedBy: user?.id ?? null, signedAt: new Date(), signature: stamp.stamp,
    updatedAt: new Date(),
  }).where(eq(inspRecords.id, id)).returning();

  // Update the approved source.
  const src = await ensureSource(db, {
    partNumber: rec.partNumber, supplierId: rec.supplierId,
    supplierFactory: rec.supplierFactory, receivingLocation: rec.receivingLocation,
    siteId: rec.siteId,
  });
  const today = new Date().toISOString().slice(0, 10);
  if (outcome === "passed") {
    let months = 6;
    if (rec.planId) {
      const [plan] = await db.select({ repeatIntervalMonths: inspPlans.repeatIntervalMonths }).from(inspPlans).where(eq(inspPlans.id, rec.planId));
      if (plan?.repeatIntervalMonths) months = plan.repeatIntervalMonths;
    }
    await db.update(inspApprovedSources).set({
      status: "approved", lastFaiDate: today, lastResult: "passed",
      nextDueDate: addMonths(today, months), lastFaiId: id, updatedAt: new Date(),
    }).where(eq(inspApprovedSources.id, src.id));
  } else {
    await db.update(inspApprovedSources).set({
      status: "suspended", lastFaiDate: today, lastResult: "failed",
      lastFaiId: id, updatedAt: new Date(),
    }).where(eq(inspApprovedSources.id, src.id));
  }

  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "status_change",
    changes: {
      what: "FAI sign-off",
      description: `Signed FAI record ${rec.faiNumber} as ${outcome.toUpperCase()} by ${stamp.stamp}. Source ${rec.partNumber} is now ${outcome === "passed" ? "Approved" : "Suspended"}.`,
    },
    performedBy: user?.id ?? null,
  });
  return updated;
}

/* ---------------- Dashboard ---------------- */

export async function dashboard(db: Db, user: any, siteId: number | null) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view FAI dashboard");
  const sf = siteFilter(db, inspRecords, siteId);
  const base = sf ? and(sf) : undefined;
  const count = async (status: string) => {
    const [r] = await db.select({ n: sql<number>`count(*)` }).from(inspRecords)
      .where(base ? and(base, eq(inspRecords.status, status)) : eq(inspRecords.status, status));
    return Number(r.n);
  };
  const open = (await count("draft")) + (await count("in_inspection"));
  const awaiting = await count("awaiting_signoff");
  const ninety = new Date(); ninety.setDate(ninety.getDate() - 90);
  const [failed90] = await db.select({ n: sql<number>`count(*)` }).from(inspRecords)
    .where(base ? and(base, eq(inspRecords.status, "failed"), sql`${inspRecords.updatedAt} >= ${ninety}`) : and(eq(inspRecords.status, "failed"), sql`${inspRecords.updatedAt} >= ${ninety}`));
  const today = new Date().toISOString().slice(0, 10);
  const in30 = new Date(); in30.setDate(in30.getDate() + 30);
  const in30s = in30.toISOString().slice(0, 10);
  const sCond = siteFilter(db, inspApprovedSources, siteId);
  const [due30] = await db.select({ n: sql<number>`count(*)` }).from(inspApprovedSources)
    .where(sCond
      ? and(sCond, sql`${inspApprovedSources.nextDueDate} >= ${today}`, sql`${inspApprovedSources.nextDueDate} <= ${in30s}`)
      : and(sql`${inspApprovedSources.nextDueDate} >= ${today}`, sql`${inspApprovedSources.nextDueDate} <= ${in30s}`));
  const [overdue] = await db.select({ n: sql<number>`count(*)` }).from(inspApprovedSources)
    .where(sCond
      ? and(sCond, sql`${inspApprovedSources.nextDueDate} < ${today}`)
      : sql`${inspApprovedSources.nextDueDate} < ${today}`);
  const [notApproved] = await db.select({ n: sql<number>`count(*)` }).from(inspApprovedSources)
    .where(sCond ? and(sCond, or(eq(inspApprovedSources.status, "not_approved"), eq(inspApprovedSources.status, "fai_required"))!) : or(eq(inspApprovedSources.status, "not_approved"), eq(inspApprovedSources.status, "fai_required"))!);
  return {
    open, awaitingSignoff: awaiting, failed90: Number(failed90.n),
    due30: Number(due30.n), overdue: Number(overdue.n), notApproved: Number(notApproved.n),
  };
}

export { deny };
