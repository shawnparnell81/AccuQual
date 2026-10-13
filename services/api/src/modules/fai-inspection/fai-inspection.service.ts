import { and, asc, desc, eq, inArray, like, or, sql } from "drizzle-orm";
import { AppError } from "../../utils/appError.js";
import { pool } from "../../db/index.js";
import { recordAuditTrail, recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import {
  FAI_CREATE_PERMISSION, FAI_DELETE_PERMISSION, FAI_EDIT_PERMISSION,
  FAI_SIGNOFF_PERMISSION, FAI_VIEW_PERMISSION, FAI_PLANS_MANAGE_PERMISSION, FAI_SOURCES_MANAGE_PERMISSION,
} from "../roles/roleAccess.js";
import { inspPlans, inspPlanCharacteristics, inspApprovedSources, inspRecords, inspResultLines } from "../../drizzle/schema/faiInspection.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import { ISO_DOCUMENTS_FOLDER } from "../document-folders/formFiling.js";
import { aqlLookup } from "./aql.js";
import { calcLimits, judgeLine, type LimitType } from "./fai-inspection.logic.js";
import { dueStatusFor } from "./fai-due-status.js";
import { faiRandomPullBatches, faiRandomPullItems } from "../../drizzle/schema/faiScheduling.js";
import { notifyAwaitingSignoff, notifySignedOff } from "./fai-notifications.service.js";
import { productTypeFor, type FaiProductType } from "./fai-product-type.js";
import { openInspectionNcr, requireNcrEdit } from "../ncr/inspectionNcr.js";
import { suppliers } from "../../drizzle/schema/supplier.js";

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

/** Non-throwing check — used to tell the web app whether to show the Attach buttons (no role names there). */
async function hasPerm(db: Db, user: any, permission: string): Promise<boolean> {
  return roleHasPermission(db, user?.role ?? user?.roleName, permission);
}

function siteFilter(db: Db, table: any, siteId: number | null) {
  return siteId ? eq(table.siteId, siteId) : undefined;
}

/** The existing validation forms these FAI records attach to. Column names (linkedCsaFaiId/linkedFuelPumpFaiId) stay as-is. */
const VALIDATION_FORM: Record<Exclude<FaiProductType, null>, { column: "linkedCsaFaiId" | "linkedFuelPumpFaiId"; label: string; formId: string }> = {
  csa: { column: "linkedCsaFaiId", label: "CSA Validation Report", formId: "FRM-VAL-001" },
  fuel_pump: { column: "linkedFuelPumpFaiId", label: "Fuel Pump Validation", formId: "FRM-VAL-007" },
};

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
  const rows = await db.select().from(inspApprovedSources).where(conds.length ? and(...conds) : undefined).orderBy(asc(inspApprovedSources.nextDueDate));
  // Phase 2: the row-level "Due in 30 days" / "Overdue" flag, same math the dashboard tiles and the daily scheduler use.
  return rows.map((r: any) => ({ ...r, dueStatus: dueStatusFor(r.nextDueDate) }));
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

function attachedFormsFor(rec: any): { formType: Exclude<FaiProductType, null>; reportId: number; title: string; openPath: string }[] {
  const out: { formType: Exclude<FaiProductType, null>; reportId: number; title: string; openPath: string }[] = [];
  for (const type of ["csa", "fuel_pump"] as const) {
    const reportId = rec[VALIDATION_FORM[type].column];
    if (reportId) out.push({ formType: type, reportId, title: `${VALIDATION_FORM[type].label} (${VALIDATION_FORM[type].formId})`, openPath: `/validation-reports/${reportId}` });
  }
  return out;
}

export async function getRecord(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view FAI record");
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  const lines = await db.select().from(inspResultLines).where(eq(inspResultLines.recordId, id)).orderBy(asc(inspResultLines.sortOrder));
  const canEdit = await hasPerm(db, user, FAI_EDIT_PERMISSION);
  return { ...rec, lines, attachedForms: attachedFormsFor(rec), canEdit };
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

  // Auto-attach the matching existing validation form. Input = the plan's productFamily, else its
  // partDescription (insp_records itself has no description field of its own to fall back to).
  // Nothing is inferred beyond that; a null type attaches nothing.
  const type = productTypeFor(plan?.productFamily ?? plan?.partDescription ?? null);
  if (type && !rec[VALIDATION_FORM[type].column]) {
    const reportId = await attachValidationReport(db, user, rec, type);
    rec[VALIDATION_FORM[type].column] = reportId;
  }
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
  if (input.status === "awaiting_signoff" && rec.status !== "awaiting_signoff") {
    const productFamily = rec.planId ? (await db.select({ productFamily: inspPlans.productFamily }).from(inspPlans).where(eq(inspPlans.id, rec.planId)))[0]?.productFamily ?? null : null;
    // sendFaiEvent (inside this) never throws — an email failure must never block the save itself.
    await notifyAwaitingSignoff(db, updated, productFamily);
  }
  return updated;
}

function assertValidationFormType(formType: unknown): Exclude<FaiProductType, null> {
  if (formType === "csa" || formType === "fuel_pump") return formType;
  throw AppError.badRequest('formType must be "csa" or "fuel_pump".');
}

export async function attachForm(db: Db, user: any, id: number, input: any) {
  await requirePerm(db, user, FAI_EDIT_PERMISSION, "attach a validation form to a FAI record");
  const type = assertValidationFormType(input.formType);
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  if (["passed", "failed", "cancelled"].includes(rec.status)) throw new AppError("Signed or cancelled records cannot be edited.");
  if (rec[VALIDATION_FORM[type].column]) throw new AppError(`A ${VALIDATION_FORM[type].label} is already attached.`, 409);
  await attachValidationReport(db, user, rec, type);
  return getRecord(db, user, id);
}

export async function detachForm(db: Db, user: any, id: number, input: any) {
  await requirePerm(db, user, FAI_EDIT_PERMISSION, "detach a validation form from a FAI record");
  const type = assertValidationFormType(input.formType);
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  if (["passed", "failed", "cancelled"].includes(rec.status)) throw new AppError("Signed or cancelled records cannot be edited.");
  const column = VALIDATION_FORM[type].column;
  if (!rec[column]) throw AppError.notFound("Attached validation form");
  await db.update(inspRecords).set({ [column]: null, updatedAt: new Date() }).where(eq(inspRecords.id, id));
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "update",
    changes: { what: "validation form detach", description: `Detached ${VALIDATION_FORM[type].label} (${VALIDATION_FORM[type].formId}) from FAI ${rec.faiNumber}. The validation report itself was not deleted.` },
    performedBy: user?.id ?? null,
  });
  return getRecord(db, user, id);
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
        // The shared "FAI" folder is a container for every FAI record, not one record's own link —
        // it must not point at whichever record happened to create it first.
        linkedPath: name === "FAI" ? null : `/fai-inspection/records/${rec.id}`,
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

/**
 * Files an attached validation report under the record's own FAI folder. The app's real "Save as"
 * mechanism for a validation report (fileExplicitModuleCopy in document-folders/defaultFormFiling.ts)
 * files it into that form's OWN standard folder, not inside this specific FAI record's folder — so it
 * doesn't fit here; this mirrors fileRecordInFolder's own node-creation pattern instead, same as that
 * function already does for the record itself.
 */
async function fileAttachedValidationReport(db: Db, user: any, rec: any, type: Exclude<FaiProductType, null>, reportId: number) {
  const all = await db.select().from(documentFolders);
  const iso = all.find((r: any) => r.parentId == null && r.name === ISO_DOCUMENTS_FOLDER);
  const testData = iso && all.find((r: any) => r.parentId === iso.id && r.name === "Test Data Projects");
  const fai = testData && all.find((r: any) => r.parentId === testData.id && r.name === "FAI");
  if (!fai) return;
  const name = `${rec.faiNumber} – ${VALIDATION_FORM[type].label}`;
  const siblings = all.filter((r: any) => r.parentId === fai.id);
  const [created] = await db.insert(documentFolders).values({
    name, parentId: fai.id, sortOrder: siblings.length, linkedPath: `/validation-reports/${reportId}`,
  }).returning();
  if (!created) return;
  await recordAuditTrail(db, {
    entityType: "DocumentFolder", entityId: created.id, action: "create",
    changes: { description: `Filed ${VALIDATION_FORM[type].label} (${VALIDATION_FORM[type].formId}) for FAI ${rec.faiNumber}.` },
    performedBy: user?.id ?? null,
  });
}

/** Creates a blank validation report exactly like the app's own blank start (formFiling.ts's frm-val-001/frm-val-007 seeds), attaches it, audit-logs, and files it. */
async function attachValidationReport(db: Db, user: any, rec: any, type: Exclude<FaiProductType, null>) {
  const meta = VALIDATION_FORM[type];
  const [report] = await db.insert(validationReports).values({ data: { formType: type, cells: {} } }).returning();
  await db.update(inspRecords).set({ [meta.column]: report.id, updatedAt: new Date() }).where(eq(inspRecords.id, rec.id));
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: rec.id, action: "update",
    changes: { what: "validation form attach", description: `Attached ${meta.label} (${meta.formId}) to FAI ${rec.faiNumber}` },
    performedBy: user?.id ?? null,
  });
  await fileAttachedValidationReport(db, user, rec, type, report.id);
  return report.id as number;
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
  const productFamily = rec.planId ? (await db.select({ productFamily: inspPlans.productFamily }).from(inspPlans).where(eq(inspPlans.id, rec.planId)))[0]?.productFamily ?? null : null;
  await notifySignedOff(db, updated, outcome, productFamily);
  return updated;
}


/* ---------------- Submit for sign-off ---------------- */

const STATUS_LABEL: Record<string, string> = { draft: "Draft", in_inspection: "In inspection", awaiting_signoff: "Awaiting sign-off" };

/** Draft or in-inspection -> awaiting sign-off, and sends the existing "awaiting sign-off" alert. Sign-off itself is unchanged (fai.signoff + PIN). */
export async function submitForSignoff(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_EDIT_PERMISSION, "submit FAI records for sign-off");
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  if (!["draft", "in_inspection"].includes(rec.status)) {
    throw new AppError("Only a draft or in-inspection FAI record can be submitted for sign-off.", 409);
  }
  const [updated] = await db.update(inspRecords).set({ status: "awaiting_signoff", updatedAt: new Date() }).where(eq(inspRecords.id, id)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "status_change",
    changes: {
      what: "FAI submitted for sign-off",
      description: `Submitted FAI record ${rec.faiNumber} for sign-off. Status changed from ${STATUS_LABEL[rec.status] ?? rec.status} to Awaiting sign-off.`,
    },
    performedBy: user?.id ?? null,
  });
  const productFamily = rec.planId ? (await db.select({ productFamily: inspPlans.productFamily }).from(inspPlans).where(eq(inspPlans.id, rec.planId)))[0]?.productFamily ?? null : null;
  await notifyAwaitingSignoff(db, updated, productFamily);
  return getRecord(db, user, id);
}

/* ---------------- Create NCR from a failed record ---------------- */

function lineSpecText(line: any): string {
  if (line.limitLow || line.limitHigh) return `${line.limitLow ?? ""} to ${line.limitHigh ?? ""}`.trim();
  if (line.nominal) return line.nominal;
  return line.limitType === "attribute" ? "Pass" : "(blank)";
}

/** Opens a real, new NCR for a failed FAI record, pre-filled and linked both ways. Needs fai.view plus the existing NCR create access. */
export async function createNcrFromRecord(db: Db, user: any, req: any, id: number) {
  await requirePerm(db, user, FAI_VIEW_PERMISSION, "view FAI record");
  await requireNcrEdit(db, { id: user?.id, roleName: user?.roleName ?? user?.role ?? null, department: user?.department ?? null });
  const [rec] = await db.select().from(inspRecords).where(eq(inspRecords.id, id));
  if (!rec) throw AppError.notFound("FAI record not found.");
  if (rec.ncrId) return { id: rec.ncrId, existing: true };
  if (rec.status !== "failed") throw new AppError("Only a failed FAI record can open an NCR.", 409);
  const lines = await db.select().from(inspResultLines).where(eq(inspResultLines.recordId, id)).orderBy(asc(inspResultLines.sortOrder));
  const rows = lines
    .filter((line: any) => line.result === "fail")
    .map((line: any) => ({ measurement: line.characteristicName, spec: lineSpecText(line), actual: line.measuredValue || line.attributeResult || "(blank)" }));
  if (rows.length === 0) rows.push({ measurement: "FAI result", spec: "Pass", actual: "Failed at sign-off" });
  const supplier = rec.supplierId ? (await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, rec.supplierId)))[0]?.name ?? null : null;
  const contextLines = [
    `FAI record: ${rec.faiNumber}`,
    `Part number: ${rec.partNumber}`,
    ...(supplier ? [`Supplier: ${supplier}${rec.supplierFactory ? ` (${rec.supplierFactory})` : ""}`] : []),
    ...(rec.poReference ? [`PO / lot reference: ${rec.poReference}`] : []),
    ...(rec.lotSize ? [`Lot size: ${rec.lotSize}`] : []),
  ];
  const created = await openInspectionNcr(
    db,
    {
      formTitle: `FAI ${rec.faiNumber}`,
      part: rec.partNumber,
      path: `/fai-inspection/records/${id}`,
      formType: "first_article",
      sourceId: id,
      kind: "fai_inspection",
      supplierId: rec.supplierId,
      siteId: rec.siteId,
      fallbackSiteId: req?.siteId,
      rows,
      contextLines,
      sourceExtra: { faiNumber: rec.faiNumber, poReference: rec.poReference, lotSize: rec.lotSize, supplierFactory: rec.supplierFactory },
      sourceAudit: { entityType: ENTITY, entityId: id },
    },
    user?.id,
  );
  await db.update(inspRecords).set({ ncrId: created.id, updatedAt: new Date() }).where(eq(inspRecords.id, id));
  return { id: created.id, existing: false };
}

/* ---------------- Approved sources: add, edit, delete ---------------- */

const SOURCE_ENTITY = "FaiSourceApproval";
const SOURCE_STATUS_LABEL: Record<string, string> = { not_approved: "Not approved", fai_required: "FAI required", approved: "Approved", suspended: "Suspended" };

async function supplierName(db: Db, supplierId: number | null | undefined): Promise<string | null> {
  if (!supplierId) return null;
  const [row] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId));
  return row?.name ?? null;
}

function describeSource(src: { partNumber: string; supplierFactory?: string | null; receivingLocation?: string | null }, supplier: string | null): string {
  return [`part ${src.partNumber}`, supplier ? `supplier ${supplier}` : null, src.supplierFactory ? `factory ${src.supplierFactory}` : null, src.receivingLocation ? `receiving location ${src.receivingLocation}` : null].filter(Boolean).join(", ");
}

async function assertSourceUnique(db: Db, key: { partNumber: string; supplierId: number | null; supplierFactory: string | null; receivingLocation: string | null }, exceptId?: number) {
  const rows = await db.select({ id: inspApprovedSources.id }).from(inspApprovedSources).where(and(
    eq(inspApprovedSources.partNumber, key.partNumber),
    key.supplierId ? eq(inspApprovedSources.supplierId, key.supplierId) : sql`${inspApprovedSources.supplierId} IS NULL`,
    key.supplierFactory ? eq(inspApprovedSources.supplierFactory, key.supplierFactory) : sql`${inspApprovedSources.supplierFactory} IS NULL`,
    key.receivingLocation ? eq(inspApprovedSources.receivingLocation, key.receivingLocation) : sql`${inspApprovedSources.receivingLocation} IS NULL`,
  ));
  if (rows.some((row: any) => row.id !== exceptId)) throw new AppError("That part, supplier, factory and receiving location is already an approved source.", 409);
}

export async function createSource(db: Db, user: any, siteId: number | null, input: any) {
  await requirePerm(db, user, FAI_SOURCES_MANAGE_PERMISSION, "add approved sources");
  const key = {
    partNumber: input.partNumber.trim(),
    supplierId: input.supplierId ?? null,
    supplierFactory: input.supplierFactory?.trim() || null,
    receivingLocation: input.receivingLocation?.trim() || null,
  };
  await assertSourceUnique(db, key);
  const status = input.status ?? "fai_required";
  const [row] = await db.insert(inspApprovedSources).values({ ...key, status, siteId: siteId ?? null }).returning();
  await recordAuditTrail(db, {
    entityType: SOURCE_ENTITY, entityId: row.id, action: "create",
    changes: { what: "approved source", description: `Added approved source: ${describeSource(key, await supplierName(db, key.supplierId))}. Starting status: ${SOURCE_STATUS_LABEL[status] ?? status}.` },
    performedBy: user?.id ?? null,
  });
  return row;
}

export async function updateSource(db: Db, user: any, id: number, input: any) {
  await requirePerm(db, user, FAI_SOURCES_MANAGE_PERMISSION, "edit approved sources");
  const [src] = await db.select().from(inspApprovedSources).where(eq(inspApprovedSources.id, id));
  if (!src) throw AppError.notFound("Approved source not found.");
  const next = {
    partNumber: input.partNumber !== undefined ? input.partNumber.trim() : src.partNumber,
    supplierId: input.supplierId !== undefined ? input.supplierId : src.supplierId,
    supplierFactory: input.supplierFactory !== undefined ? input.supplierFactory?.trim() || null : src.supplierFactory,
    receivingLocation: input.receivingLocation !== undefined ? input.receivingLocation?.trim() || null : src.receivingLocation,
  };
  await assertSourceUnique(db, next, id);
  const [updated] = await db.update(inspApprovedSources).set({ ...next, updatedAt: new Date() }).where(eq(inspApprovedSources.id, id)).returning();
  const before = describeSource(src, await supplierName(db, src.supplierId));
  const after = describeSource(next, await supplierName(db, next.supplierId));
  await recordAuditTrail(db, {
    entityType: SOURCE_ENTITY, entityId: id, action: "update",
    changes: { what: "approved source", description: before === after ? `Saved approved source (${after}) with no changes.` : `Changed approved source from (${before}) to (${after}).` },
    performedBy: user?.id ?? null,
  });
  return updated;
}

export async function deleteSource(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_SOURCES_MANAGE_PERMISSION, "delete approved sources");
  const [src] = await db.select().from(inspApprovedSources).where(eq(inspApprovedSources.id, id));
  if (!src) throw AppError.notFound("Approved source not found.");
  const [onList] = await db.select({ id: faiRandomPullItems.id }).from(faiRandomPullItems).where(eq(faiRandomPullItems.sourceId, id)).limit(1);
  if (onList) throw new AppError("This source is on a random-pull list, so it can't be deleted.", 409);
  await db.delete(inspApprovedSources).where(eq(inspApprovedSources.id, id));
  await recordAuditTrail(db, {
    entityType: SOURCE_ENTITY, entityId: id, action: "delete",
    changes: { what: "approved source", description: `Deleted approved source: ${describeSource(src, await supplierName(db, src.supplierId))}. Its status was ${SOURCE_STATUS_LABEL[src.status] ?? src.status}.` },
    performedBy: user?.id ?? null,
  });
  return { deleted: true };
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

  // Phase 2: random-pull items not yet completed, split into "still within the year" vs "overdue" (a past year's pull that never finished).
  const approvedBatchIds = (await db.select({ id: faiRandomPullBatches.id, year: faiRandomPullBatches.year }).from(faiRandomPullBatches).where(eq(faiRandomPullBatches.status, "approved")));
  let pullsPending = 0;
  let pullsOverdue = 0;
  if (approvedBatchIds.length > 0) {
    const items = await db.select({ batchId: faiRandomPullItems.batchId, linkedRecordId: faiRandomPullItems.linkedRecordId }).from(faiRandomPullItems)
      .where(inArray(faiRandomPullItems.batchId, approvedBatchIds.map((b: any) => b.id)));
    const linkedIds = items.map((i: any) => i.linkedRecordId).filter((id: number | null): id is number => id != null);
    const linkedRecords = linkedIds.length ? await db.select({ id: inspRecords.id, status: inspRecords.status }).from(inspRecords).where(inArray(inspRecords.id, linkedIds)) : [];
    const statusById = new Map<number, string>(linkedRecords.map((r: any) => [r.id as number, r.status as string]));
    const yearById = new Map<number, number>(approvedBatchIds.map((b: any) => [b.id as number, b.year as number]));
    const currentYear = new Date().getFullYear();
    for (const item of items) {
      const recStatus = item.linkedRecordId ? statusById.get(item.linkedRecordId) : null;
      const isDone = recStatus === "passed" || recStatus === "failed";
      if (isDone) continue;
      if ((yearById.get(item.batchId) ?? currentYear) < currentYear) pullsOverdue++;
      else pullsPending++;
    }
  }

  return {
    open, awaitingSignoff: awaiting, failed90: Number(failed90.n),
    due30: Number(due30.n), overdue: Number(overdue.n), notApproved: Number(notApproved.n),
    pullsPending, pullsOverdue,
  };
}

export { deny };
