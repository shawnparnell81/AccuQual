import type { Request } from "express";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import {
  faiAnnualPulls,
  faiInspectionPlans,
  faiNumberCounters,
  faiPlanCharacteristics,
  faiPlanRevisions,
  faiRecords,
  faiResultLines,
  faiSourceApprovals,
  type FaiInspectionPlan,
  type FaiPlanRevision,
  type FaiRecord,
  type FaiResultLine,
} from "../../drizzle/schema/faiSourceControl.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { notifyRecipients } from "../notifications/notification.service.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { mapSeverityToClassification, ncrIsoDate, syncNcrFormData } from "../ncr/ncr.formSync.js";
import { noteRepeatNcr } from "../quality-automation/qualityAutomation.service.js";
import { requirePlantId } from "../sites/siteAccess.js";
import { calendarDay, safeTimeZone } from "../quality-automation/logic.js";
import { renderFaiPdf } from "./fai.pdf.js";
import type { savePlanSchema, openFaiSchema, saveResultsSchema, assignPullSchema, completePullSchema } from "./fai.validation.js";
import type { z } from "zod";
import {
  approveSource,
  auditEntry,
  canApproveFai,
  canRecordAnnualPull,
  characteristicError,
  cleanText,
  freezeCharacteristic,
  formalDate,
  formatFaiNumber,
  isCharacteristicMode,
  judgeFrozen,
  limitsLabel,
  needsAnnualPull,
  newSourceRow,
  noticeApproved,
  noticeAssigned,
  noticeDueSoon,
  noticeOverdue,
  noticePullAssigned,
  noticePullRecorded,
  noticeRejected,
  noticeSubmitted,
  readyToSubmit,
  rejectSource,
  revisionForPlanSave,
  sourceQueueBucket,
  type CharacteristicInput,
  type CharacteristicMode,
  type FaiActor,
  type PlanStructure,
} from "./fai.logic.js";

type PlanBody = z.infer<typeof savePlanSchema>;
type OpenBody = z.infer<typeof openFaiSchema>;
type ResultsBody = z.infer<typeof saveResultsSchema>;
type PullAssignBody = z.infer<typeof assignPullSchema>;
type PullCompleteBody = z.infer<typeof completePullSchema>;

function actorFrom(req: Request): FaiActor & { id: number } {
  return { id: req.user!.id, roleName: req.user?.roleName ?? null, department: req.user?.department ?? null };
}

async function actorLabel(db: Db, userId: number): Promise<string> {
  const [person] = await db.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, userId));
  return formatUserLabel(person, userId);
}

async function companyToday(db: Db): Promise<string> {
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  return calendarDay(new Date(), safeTimeZone(row?.profile?.timezone));
}

async function writeAudit(db: Db, entityType: string, entityId: number, action: "create" | "update" | "status_change", who: string, what: string, description: string, performedBy?: number) {
  await recordAuditTrail(db, {
    entityType,
    entityId,
    action,
    changes: auditEntry(who, what, new Date(), description),
    performedBy,
  });
}

async function sendNotice(db: Db, emails: string[], text: string, entityType: string, entityId: number) {
  const recipients = [...new Set(emails.map((email) => email.trim()).filter(Boolean))];
  if (recipients.length === 0) return;
  await notifyRecipients(db, recipients, text, text, entityType, entityId);
}

async function activeEmails(db: Db, userIds: number[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const rows = await db.select({ email: users.email }).from(users).where(and(inArray(users.id, userIds), eq(users.isActive, true)));
  return rows.map((row) => row.email);
}

async function qualityEmails(db: Db): Promise<string[]> {
  const rows = await db.select({ email: users.email }).from(users).where(and(eq(users.department, "quality"), eq(users.isActive, true)));
  return rows.map((row) => row.email);
}

async function loadPerson(db: Db, userId: number) {
  const [person] = await db
    .select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive, department: users.department })
    .from(users)
    .where(eq(users.id, userId));
  if (!person || !person.isActive) throw AppError.badRequest("Choose an active person.");
  return person;
}

function asMode(value: string, name: string): CharacteristicMode {
  if (!isCharacteristicMode(value)) throw AppError.badRequest(`${name} has a limit mode this record does not use.`);
  return value;
}

function toCharacteristic(row: {
  balloon: string | null;
  name: string;
  mode: string;
  nominal: string | null;
  percent: string | null;
  plusTolerance: string | null;
  minusTolerance: string | null;
  specMin: string | null;
  specMax: string | null;
}): CharacteristicInput {
  return {
    balloon: row.balloon,
    name: row.name,
    mode: asMode(row.mode, row.name),
    nominal: row.nominal,
    percent: row.percent,
    plusTolerance: row.plusTolerance,
    minusTolerance: row.minusTolerance,
    specMin: row.specMin,
    specMax: row.specMax,
  };
}

function presentLine(row: FaiResultLine) {
  const mode = asMode(row.mode, row.name);
  const frozen = {
    mode,
    nominal: row.nominal,
    percent: row.percent,
    plusTolerance: row.plusTolerance,
    minusTolerance: row.minusTolerance,
    limitLow: row.limitLow,
    limitHigh: row.limitHigh,
  };
  return { ...row, mode, limits: limitsLabel(frozen), result: row.result ?? "" };
}

async function supplierName(db: Db, supplierId: number): Promise<string> {
  const [row] = await db.select({ name: suppliers.name }).from(suppliers).where(eq(suppliers.id, supplierId));
  if (!row) throw AppError.badRequest("Choose a supplier.");
  return row.name;
}

function structureFrom(body: {
  scope: "part" | "family";
  partNumber?: string | null;
  productFamily?: string | null;
  supplierId?: number | null;
  cadenceMonths?: number;
  characteristics: CharacteristicInput[];
}): PlanStructure {
  return {
    scope: body.scope,
    partNumber: cleanText(body.partNumber),
    productFamily: cleanText(body.productFamily),
    supplierId: body.supplierId ?? null,
    cadenceMonths: body.cadenceMonths ?? 6,
    characteristics: body.characteristics,
  };
}

function assertPlanIdentity(structure: PlanStructure) {
  if (structure.scope === "part" && !structure.partNumber) throw AppError.badRequest("A part plan needs a part number.");
  if (structure.scope === "family" && !structure.productFamily) throw AppError.badRequest("A product-family plan needs a family name.");
  if (structure.characteristics.length === 0) throw AppError.badRequest("Add at least one characteristic.");
  for (const row of structure.characteristics) {
    const error = characteristicError(row);
    if (error) throw AppError.badRequest(error);
  }
}

async function loadPlan(db: Db, id: number): Promise<FaiInspectionPlan> {
  const [plan] = await db.select().from(faiInspectionPlans).where(eq(faiInspectionPlans.id, id));
  if (!plan) throw AppError.notFound("Inspection plan");
  return plan;
}

async function loadRevision(db: Db, planId: number, revision: number): Promise<FaiPlanRevision> {
  const [row] = await db.select().from(faiPlanRevisions).where(and(eq(faiPlanRevisions.planId, planId), eq(faiPlanRevisions.revision, revision)));
  if (!row) throw AppError.notFound("Plan revision");
  return row;
}

async function revisionCharacteristics(db: Db, revisionId: number) {
  return db.select().from(faiPlanCharacteristics).where(eq(faiPlanCharacteristics.revisionId, revisionId)).orderBy(asc(faiPlanCharacteristics.sortOrder), asc(faiPlanCharacteristics.id));
}

async function presentPlan(db: Db, plan: FaiInspectionPlan, revisionNumber?: number) {
  const revision = await loadRevision(db, plan.id, revisionNumber ?? plan.currentRevision);
  const characteristics = await revisionCharacteristics(db, revision.id);
  const revisions = await db
    .select({ revision: faiPlanRevisions.revision, cadenceMonths: faiPlanRevisions.cadenceMonths, createdAt: faiPlanRevisions.createdAt })
    .from(faiPlanRevisions)
    .where(eq(faiPlanRevisions.planId, plan.id))
    .orderBy(desc(faiPlanRevisions.revision));
  const supplierId = revision.supplierId;
  let supplier: string | null = null;
  if (supplierId) supplier = await supplierName(db, supplierId);
  return {
    id: plan.id,
    name: plan.name,
    partName: plan.partName,
    notes: plan.notes,
    retired: plan.retiredAt != null,
    currentRevision: plan.currentRevision,
    viewingRevision: revision.revision,
    readOnly: revision.revision !== plan.currentRevision || plan.retiredAt != null,
    scope: revision.scope,
    partNumber: revision.partNumber,
    productFamily: revision.productFamily,
    supplierId,
    supplierName: supplier,
    cadenceMonths: revision.cadenceMonths,
    characteristics: characteristics.map(toCharacteristic),
    revisions: revisions.map((row) => ({ ...row, createdAt: row.createdAt?.toISOString() ?? null })),
  };
}

export async function listLookups(db: Db) {
  const supplierRows = await db.select({ id: suppliers.id, name: suppliers.name, status: suppliers.status }).from(suppliers).orderBy(asc(suppliers.name));
  const people = await db
    .select({ id: users.id, name: users.name, email: users.email, department: users.department })
    .from(users)
    .where(and(eq(users.isActive, true), inArray(users.department, ["quality", "engineering"])))
    .orderBy(asc(users.name));
  const plans = await db
    .select({
      id: faiInspectionPlans.id,
      name: faiInspectionPlans.name,
      scope: faiInspectionPlans.scope,
      partNumber: faiInspectionPlans.partNumber,
      partName: faiInspectionPlans.partName,
      productFamily: faiInspectionPlans.productFamily,
      supplierId: faiInspectionPlans.supplierId,
      currentRevision: faiInspectionPlans.currentRevision,
    })
    .from(faiInspectionPlans)
    .where(isNull(faiInspectionPlans.retiredAt))
    .orderBy(asc(faiInspectionPlans.name));
  return { suppliers: supplierRows, people, plans };
}

export async function listPlans(db: Db) {
  const rows = await db.select().from(faiInspectionPlans).orderBy(desc(faiInspectionPlans.updatedAt), desc(faiInspectionPlans.id));
  const supplierIds = [...new Set(rows.map((row) => row.supplierId).filter((id): id is number => id != null))];
  const names = new Map<number, string>();
  if (supplierIds.length > 0) {
    const found = await db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(inArray(suppliers.id, supplierIds));
    for (const row of found) names.set(row.id, row.name);
  }
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scope: row.scope,
    partNumber: row.partNumber,
    partName: row.partName,
    productFamily: row.productFamily,
    supplierId: row.supplierId,
    supplierName: row.supplierId ? names.get(row.supplierId) ?? null : null,
    cadenceMonths: row.cadenceMonths,
    currentRevision: row.currentRevision,
    retired: row.retiredAt != null,
  }));
}

export async function getPlan(db: Db, id: number, revision?: number) {
  return presentPlan(db, await loadPlan(db, id), revision);
}

async function insertRevision(db: Db, planId: number, revision: number, structure: PlanStructure, userId: number) {
  const [created] = await db
    .insert(faiPlanRevisions)
    .values({
      planId,
      revision,
      cadenceMonths: structure.cadenceMonths,
      scope: structure.scope,
      partNumber: structure.partNumber,
      productFamily: structure.productFamily,
      supplierId: structure.supplierId,
      createdBy: userId,
    })
    .returning();
  await db.insert(faiPlanCharacteristics).values(
    structure.characteristics.map((row, index) => ({
      revisionId: created!.id,
      sortOrder: index + 1,
      balloon: cleanText(row.balloon),
      name: cleanText(row.name) ?? "",
      mode: row.mode,
      nominal: cleanText(row.nominal),
      percent: cleanText(row.percent),
      plusTolerance: cleanText(row.plusTolerance),
      minusTolerance: cleanText(row.minusTolerance),
      specMin: cleanText(row.specMin),
      specMax: cleanText(row.specMax),
    })),
  );
  return created!;
}

export async function savePlan(db: Db, userId: number, body: PlanBody, planId?: number) {
  if (body.supplierId) await supplierName(db, body.supplierId);
  const structure = structureFrom(body);
  structure.cadenceMonths = body.cadenceMonths ?? 6;
  assertPlanIdentity(structure);
  const who = await actorLabel(db, userId);
  const now = new Date();

  if (!planId) {
    const [plan] = await db
      .insert(faiInspectionPlans)
      .values({
        name: body.name.trim(),
        scope: structure.scope,
        partNumber: structure.partNumber,
        partName: cleanText(body.partName),
        productFamily: structure.productFamily,
        supplierId: structure.supplierId,
        cadenceMonths: structure.cadenceMonths,
        currentRevision: 1,
        notes: cleanText(body.notes),
        createdBy: userId,
        updatedAt: now,
      })
      .returning();
    await insertRevision(db, plan!.id, 1, structure, userId);
    await writeAudit(db, "FaiInspectionPlan", plan!.id, "create", who, "Created inspection plan", `Created inspection plan ${body.name.trim()}, revision 1.`, userId);
    return presentPlan(db, plan!);
  }

  const plan = await loadPlan(db, planId);
  if (plan.retiredAt) throw AppError.badRequest("This plan is retired.");
  const current = await loadRevision(db, plan.id, plan.currentRevision);
  const previousRows = await revisionCharacteristics(db, current.id);
  const previous = structureFrom({
    scope: current.scope === "family" ? "family" : "part",
    partNumber: current.partNumber,
    productFamily: current.productFamily,
    supplierId: current.supplierId,
    cadenceMonths: current.cadenceMonths,
    characteristics: previousRows.map(toCharacteristic),
  });
  const nextRevision = revisionForPlanSave(plan.currentRevision, previous, structure);
  if (nextRevision !== plan.currentRevision) await insertRevision(db, plan.id, nextRevision, structure, userId);
  const [updated] = await db
    .update(faiInspectionPlans)
    .set({
      name: body.name.trim(),
      scope: structure.scope,
      partNumber: structure.partNumber,
      partName: cleanText(body.partName),
      productFamily: structure.productFamily,
      supplierId: structure.supplierId,
      cadenceMonths: structure.cadenceMonths,
      currentRevision: nextRevision,
      notes: cleanText(body.notes),
      updatedAt: now,
    })
    .where(eq(faiInspectionPlans.id, plan.id))
    .returning();
  const description =
    nextRevision === plan.currentRevision
      ? `Updated inspection plan ${body.name.trim()} without a new revision.`
      : `Revised inspection plan ${body.name.trim()} to revision ${nextRevision}. Earlier first articles keep the limits they copied.`;
  await writeAudit(db, "FaiInspectionPlan", plan.id, "update", who, "Saved inspection plan", description, userId);
  return presentPlan(db, updated!);
}

export async function retirePlan(db: Db, userId: number, planId: number) {
  const plan = await loadPlan(db, planId);
  if (plan.retiredAt) return presentPlan(db, plan);
  const [updated] = await db.update(faiInspectionPlans).set({ retiredAt: new Date(), updatedAt: new Date() }).where(eq(faiInspectionPlans.id, plan.id)).returning();
  const who = await actorLabel(db, userId);
  await writeAudit(db, "FaiInspectionPlan", plan.id, "status_change", who, "Retired inspection plan", `Retired inspection plan ${plan.name}. Open first articles are unchanged.`, userId);
  return presentPlan(db, updated!);
}

async function allocateNumber(db: Db, today: string): Promise<string> {
  const year = Number(today.slice(0, 4));
  const [row] = await db
    .insert(faiNumberCounters)
    .values({ year, lastValue: 1 })
    .onConflictDoUpdate({ target: faiNumberCounters.year, set: { lastValue: sql`${faiNumberCounters.lastValue} + 1` } })
    .returning({ lastValue: faiNumberCounters.lastValue });
  return formatFaiNumber(year, row!.lastValue);
}

async function ensureSource(db: Db, partNumber: string, supplierId: number, name: string, cadenceMonths: number, userId: number) {
  const [existing] = await db.select().from(faiSourceApprovals).where(and(eq(faiSourceApprovals.partNumber, partNumber), eq(faiSourceApprovals.supplierId, supplierId)));
  if (existing) return existing;
  const createdState = newSourceRow(cadenceMonths);
  const [created] = await db
    .insert(faiSourceApprovals)
    .values({
      partNumber,
      supplierId,
      supplierName: name,
      status: createdState.status,
      cadenceMonths: createdState.cadenceMonths,
      updatedAt: new Date(),
    })
    .returning();
  const who = await actorLabel(db, userId);
  await writeAudit(
    db,
    "FaiSourceApproval",
    created!.id,
    "create",
    who,
    "Opened source row",
    `${partNumber} from ${name} is pending. A new supplier starts pending until Quality approves a first article.`,
    userId,
  );
  return created!;
}

async function loadRecord(db: Db, id: number): Promise<FaiRecord> {
  const [row] = await db.select().from(faiRecords).where(eq(faiRecords.id, id));
  if (!row) throw AppError.notFound("First article");
  return row;
}

async function recordLines(db: Db, faiId: number) {
  return db.select().from(faiResultLines).where(eq(faiResultLines.faiId, faiId)).orderBy(asc(faiResultLines.sortOrder), asc(faiResultLines.id));
}

async function presentRecord(db: Db, record: FaiRecord) {
  const lines = await recordLines(db, record.id);
  const [plan] = await db.select({ name: faiInspectionPlans.name }).from(faiInspectionPlans).where(eq(faiInspectionPlans.id, record.planId));
  return { ...record, planName: plan?.name ?? "", lines: lines.map(presentLine), ncrNumber: record.ncrId ? `NCR-${record.ncrId}` : null };
}

export async function listRecords(db: Db) {
  return db
    .select({
      id: faiRecords.id,
      number: faiRecords.number,
      partNumber: faiRecords.partNumber,
      partName: faiRecords.partName,
      supplierName: faiRecords.supplierName,
      status: faiRecords.status,
      planRevision: faiRecords.planRevision,
      createdAt: faiRecords.createdAt,
    })
    .from(faiRecords)
    .orderBy(desc(faiRecords.createdAt))
    .limit(100);
}

export async function getRecord(db: Db, id: number) {
  return presentRecord(db, await loadRecord(db, id));
}

export async function openRecord(db: Db, userId: number, body: OpenBody) {
  const plan = await loadPlan(db, body.planId);
  if (plan.retiredAt) throw AppError.badRequest("This plan is retired. Choose a current plan.");
  const revision = await loadRevision(db, plan.id, plan.currentRevision);
  const characteristics = await revisionCharacteristics(db, revision.id);
  if (characteristics.length === 0) throw AppError.badRequest("This plan has no characteristics.");
  const structure = structureFrom({
    scope: revision.scope === "family" ? "family" : "part",
    partNumber: revision.partNumber,
    productFamily: revision.productFamily,
    supplierId: revision.supplierId,
    cadenceMonths: revision.cadenceMonths,
    characteristics: characteristics.map(toCharacteristic),
  });
  let partNumber = cleanText(body.partNumber);
  if (structure.scope === "part") {
    if (!structure.partNumber) throw AppError.badRequest("This plan has no part number.");
    if (partNumber && partNumber !== structure.partNumber) throw AppError.badRequest("This plan is for a single part. Open the first article on that part number.");
    partNumber = structure.partNumber;
  } else if (!partNumber) {
    throw AppError.badRequest("Enter the part number for this product family.");
  }
  if (structure.supplierId && structure.supplierId !== body.supplierId) throw AppError.badRequest("This plan is limited to one supplier.");
  const name = await supplierName(db, body.supplierId);
  if (body.assignedTo) await loadPerson(db, body.assignedTo);
  const today = await companyToday(db);
  const number = await allocateNumber(db, today);
  const frozen = characteristics.map((row) => {
    try {
      return freezeCharacteristic(toCharacteristic(row));
    } catch (err) {
      throw AppError.badRequest(err instanceof Error ? err.message : "A characteristic on this plan is incomplete.");
    }
  });
  const [created] = await db
    .insert(faiRecords)
    .values({
      number,
      planId: plan.id,
      revisionId: revision.id,
      planRevision: revision.revision,
      partNumber,
      partName: cleanText(body.partName) ?? plan.partName,
      supplierId: body.supplierId,
      supplierName: name,
      status: "open",
      assignedTo: body.assignedTo ?? null,
      openedBy: userId,
      updatedAt: new Date(),
    })
    .returning();
  await db.insert(faiResultLines).values(
    frozen.map((line, index) => ({
      faiId: created!.id,
      sortOrder: index + 1,
      balloon: line.balloon,
      name: line.name,
      mode: line.mode,
      nominal: line.nominal,
      percent: line.percent,
      plusTolerance: line.plusTolerance,
      minusTolerance: line.minusTolerance,
      specMin: line.specMin,
      specMax: line.specMax,
      limitLow: line.limitLow,
      limitHigh: line.limitHigh,
      result: "",
    })),
  );
  await ensureSource(db, partNumber, body.supplierId, name, revision.cadenceMonths, userId);
  const who = await actorLabel(db, userId);
  await writeAudit(
    db,
    "FaiRecord",
    created!.id,
    "create",
    who,
    "Opened first article",
    `Opened ${number} for ${partNumber} from ${name}. Characteristic limits were copied from plan revision ${revision.revision} and will not change if the plan is revised.`,
    userId,
  );
  if (body.assignedTo) {
    const assignee = await loadPerson(db, body.assignedTo);
    await sendNotice(db, [assignee.email], noticeAssigned(number, formatUserLabel(assignee, assignee.id)), "FaiRecord", created!.id);
  }
  return presentRecord(db, created!);
}

export async function saveResults(db: Db, userId: number, id: number, body: ResultsBody) {
  const record = await loadRecord(db, id);
  if (record.status !== "open") throw AppError.badRequest("Results can be entered while the first article is open.");
  const lines = await recordLines(db, id);
  const byId = new Map(lines.map((line) => [line.id, line]));
  for (const patch of body.lines) {
    const line = byId.get(patch.id);
    if (!line || line.faiId !== id) throw AppError.badRequest("One of these rows is not on this first article.");
    const mode = asMode(line.mode, line.name);
    const actual = cleanText(patch.actual);
    const attributeResult = mode === "attribute" ? patch.attributeResult ?? null : null;
    const result = judgeFrozen({ mode, limitLow: line.limitLow, limitHigh: line.limitHigh }, actual, attributeResult);
    await db.update(faiResultLines).set({ actual: mode === "attribute" ? null : actual, attributeResult, result }).where(eq(faiResultLines.id, line.id));
  }
  const [updated] = await db
    .update(faiRecords)
    .set({ comments: cleanText(body.comments), updatedAt: new Date() })
    .where(eq(faiRecords.id, id))
    .returning();
  const who = await actorLabel(db, userId);
  await writeAudit(db, "FaiRecord", id, "update", who, "Entered results", `Entered results on ${record.number}. Pass and fail use the limits copied when it was opened.`, userId);
  return presentRecord(db, updated!);
}

export async function assignRecord(db: Db, userId: number, id: number, assigneeId: number) {
  const record = await loadRecord(db, id);
  if (record.status !== "open") throw AppError.badRequest("Assignment stays with the open first article.");
  const assignee = await loadPerson(db, assigneeId);
  const [updated] = await db.update(faiRecords).set({ assignedTo: assigneeId, updatedAt: new Date() }).where(eq(faiRecords.id, id)).returning();
  const who = await actorLabel(db, userId);
  const label = formatUserLabel(assignee, assignee.id);
  await writeAudit(db, "FaiRecord", id, "update", who, "Assigned result entry", noticeAssigned(record.number, label), userId);
  await sendNotice(db, [assignee.email], noticeAssigned(record.number, label), "FaiRecord", id);
  return presentRecord(db, updated!);
}

export async function submitRecord(db: Db, userId: number, id: number) {
  const record = await loadRecord(db, id);
  if (record.status !== "open") throw AppError.badRequest("This first article has already been submitted.");
  const lines = await recordLines(db, id);
  const results = lines.map((line) => (line.result === "Pass" || line.result === "Fail" ? line.result : ""));
  if (!readyToSubmit(results)) throw AppError.badRequest("Enter a result on every characteristic before submitting for Quality review.");
  const [updated] = await db
    .update(faiRecords)
    .set({ status: "submitted", submittedBy: userId, submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(faiRecords.id, id))
    .returning();
  const who = await actorLabel(db, userId);
  const text = noticeSubmitted(record.number);
  await writeAudit(db, "FaiRecord", id, "status_change", who, "Submitted for Quality review", text, userId);
  await sendNotice(db, await qualityEmails(db), text, "FaiRecord", id);
  return presentRecord(db, updated!);
}

async function sourceFor(db: Db, record: FaiRecord) {
  const [row] = await db.select().from(faiSourceApprovals).where(and(eq(faiSourceApprovals.partNumber, record.partNumber), eq(faiSourceApprovals.supplierId, record.supplierId)));
  if (!row) throw AppError.badRequest("This part and supplier have no source row.");
  return row;
}

export async function approveRecord(req: Request, id: number) {
  const db = req.db!;
  const actor = actorFrom(req);
  if (!canApproveFai(actor)) throw AppError.forbidden("Only Quality can approve a first article.");
  const record = await loadRecord(db, id);
  if (record.status !== "submitted") throw AppError.badRequest("Submit the first article before Quality approves it.");
  const plan = await loadPlan(db, record.planId);
  const today = await companyToday(db);
  const source = await sourceFor(db, record);
  let next;
  try {
    next = approveSource(
      { status: source.status === "failed" || source.status === "approved" || source.status === "pending" ? source.status : "pending", lastPassDate: source.lastPassDate, nextDueDate: source.nextDueDate, cadenceMonths: source.cadenceMonths },
      today,
      plan.cadenceMonths,
    );
  } catch (err) {
    throw AppError.badRequest(err instanceof Error ? err.message : "The next due date could not be calculated.");
  }
  const text = noticeApproved(record.number, record.partNumber, record.supplierName, formalDate(next.nextDueDate!));
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "FaiRecord",
    entityId: id,
    field: "qualitySignature",
    description: text,
  });
  const [updated] = await db
    .update(faiRecords)
    .set({ status: "approved", outcome: "approved", decidedBy: actor.id, decidedAt: stamp.signedAt, qualitySignature: stamp.stamp, updatedAt: new Date() })
    .where(eq(faiRecords.id, id))
    .returning();
  await db
    .update(faiSourceApprovals)
    .set({
      status: next.status,
      lastPassDate: next.lastPassDate,
      nextDueDate: next.nextDueDate,
      cadenceMonths: next.cadenceMonths,
      lastFaiId: id,
      supplierName: record.supplierName,
      updatedAt: new Date(),
    })
    .where(eq(faiSourceApprovals.id, source.id));
  await writeAudit(db, "FaiRecord", id, "status_change", stamp.displayName, "Approved", text, actor.id);
  await writeAudit(db, "FaiSourceApproval", source.id, "status_change", stamp.displayName, "Approved source", text, actor.id);
  const recipients = [...(await qualityEmails(db)), ...(await activeEmails(db, [record.openedBy, record.assignedTo].filter((value): value is number => value != null)))];
  await sendNotice(db, recipients, text, "FaiRecord", id);
  return presentRecord(db, updated!);
}

export async function rejectRecord(req: Request, id: number) {
  const db = req.db!;
  const actor = actorFrom(req);
  if (!canApproveFai(actor)) throw AppError.forbidden("Only Quality can reject a first article.");
  const record = await loadRecord(db, id);
  if (record.status !== "submitted") throw AppError.badRequest("Submit the first article before Quality rejects it.");
  const lines = await recordLines(db, id);
  const failed = lines.filter((line) => line.result === "Fail").map((line) => line.name);
  const text = noticeRejected(record.number, record.partNumber, record.supplierName);
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "FaiRecord",
    entityId: id,
    field: "qualitySignature",
    description: text,
  });
  const description = [
    text,
    failed.length > 0 ? `Characteristics outside limits: ${failed.join(", ")}.` : "Quality did not approve the recorded results.",
    record.comments ? `Comments: ${record.comments}` : "",
  ]
    .filter(Boolean)
    .join(" ");
  const siteId = requirePlantId(req.siteId);
  const [createdNcr] = await db
    .insert(ncr)
    .values({
      title: `${record.number} was not approved — ${record.partNumber}`.slice(0, 200),
      description,
      severity: "medium",
      status: "ncr_created",
      supplierId: record.supplierId,
      createdBy: actor.id,
      siteId,
    })
    .returning();
  await recordAuditTrail(db, { entityType: "NCR", entityId: createdNcr!.id, action: "create", changes: { fromFaiId: id, faiNumber: record.number }, performedBy: actor.id });
  await syncNcrFormData(
    db,
    createdNcr!.id,
    {
      ncrNumber: `NCR-${createdNcr!.id}`,
      dateIssued: ncrIsoDate(createdNcr!.createdAt ?? new Date()),
      documentStatus: "Active",
      nonconformanceDescription: description,
      ncrClassification: mapSeverityToClassification("medium"),
    },
    actor.id,
  );
  await noteRepeatNcr(db, createdNcr!.id);
  const source = await sourceFor(db, record);
  const next = rejectSource({
    status: source.status === "failed" || source.status === "approved" || source.status === "pending" ? source.status : "pending",
    lastPassDate: source.lastPassDate,
    nextDueDate: source.nextDueDate,
    cadenceMonths: source.cadenceMonths,
  });
  await db
    .update(faiSourceApprovals)
    .set({ status: next.status, lastFaiId: id, supplierName: record.supplierName, updatedAt: new Date() })
    .where(eq(faiSourceApprovals.id, source.id));
  const [updated] = await db
    .update(faiRecords)
    .set({ status: "rejected", outcome: "rejected", ncrId: createdNcr!.id, decidedBy: actor.id, decidedAt: stamp.signedAt, qualitySignature: stamp.stamp, updatedAt: new Date() })
    .where(eq(faiRecords.id, id))
    .returning();
  await writeAudit(db, "FaiRecord", id, "status_change", stamp.displayName, "Rejected", `${text} NCR-${createdNcr!.id} was opened.`, actor.id);
  await writeAudit(db, "FaiSourceApproval", source.id, "status_change", stamp.displayName, "Source not approved", text, actor.id);
  const recipients = [...(await qualityEmails(db)), ...(await activeEmails(db, [record.openedBy, record.assignedTo].filter((value): value is number => value != null)))];
  await sendNotice(db, recipients, text, "FaiRecord", id);
  return presentRecord(db, updated!);
}

export async function recordPdf(db: Db, id: number) {
  const record = await loadRecord(db, id);
  if (record.status !== "approved" && record.status !== "rejected") throw AppError.badRequest("The PDF is available after Quality approves or rejects the first article.");
  const presented = await presentRecord(db, record);
  const bytes = await renderFaiPdf({
    number: record.number,
    partNumber: record.partNumber,
    partName: record.partName,
    supplierName: record.supplierName,
    planName: presented.planName,
    planRevision: record.planRevision,
    outcome: record.status === "approved" ? "Approved" : "Not approved",
    comments: record.comments,
    qualitySignature: record.qualitySignature,
    decidedOn: record.decidedAt ? record.decidedAt.toISOString().slice(0, 10) : null,
    ncrNumber: presented.ncrNumber,
    lines: presented.lines.map((line) => ({
      balloon: line.balloon,
      name: line.name,
      mode: line.mode,
      nominal: line.nominal,
      percent: line.percent,
      plusTolerance: line.plusTolerance,
      minusTolerance: line.minusTolerance,
      limitLow: line.limitLow,
      limitHigh: line.limitHigh,
      actual: line.actual,
      attributeResult: line.attributeResult,
      result: line.result,
    })),
  });
  return { filename: `${record.number}.pdf`, bytes };
}

export async function listSources(db: Db) {
  const today = await companyToday(db);
  const rows = await db.select().from(faiSourceApprovals).orderBy(asc(faiSourceApprovals.partNumber), asc(faiSourceApprovals.supplierName));
  return rows.map((row) => ({
    ...row,
    queue: sourceQueueBucket(
      { status: row.status === "approved" || row.status === "failed" || row.status === "pending" ? row.status : "pending", nextDueDate: row.nextDueDate },
      today,
    ),
  }));
}

async function noticeOnce(db: Db, sourceId: number, text: string, emails: string[]) {
  const [existing] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(eq(notificationLog.relatedEntityType, "FaiSource"), eq(notificationLog.relatedEntityId, sourceId), eq(notificationLog.body, text)))
    .limit(1);
  if (existing) return;
  await sendNotice(db, emails, text, "FaiSource", sourceId);
}

export async function buildQueue(db: Db) {
  const today = await companyToday(db);
  const open = await db
    .select({
      id: faiRecords.id,
      number: faiRecords.number,
      partNumber: faiRecords.partNumber,
      supplierName: faiRecords.supplierName,
      status: faiRecords.status,
      assignedTo: faiRecords.assignedTo,
    })
    .from(faiRecords)
    .where(inArray(faiRecords.status, ["open", "submitted"]))
    .orderBy(desc(faiRecords.createdAt));
  const sources = await listSources(db);
  const dueSoon = sources.filter((row) => row.queue === "due_soon");
  const overdue = sources.filter((row) => row.queue === "overdue");
  const failed = sources.filter((row) => row.queue === "failed");
  const emails = await qualityEmails(db);
  for (const row of dueSoon) {
    if (row.nextDueDate) await noticeOnce(db, row.id, noticeDueSoon(row.partNumber, row.supplierName, formalDate(row.nextDueDate)), emails);
  }
  for (const row of overdue) await noticeOnce(db, row.id, noticeOverdue(row.partNumber, row.supplierName), emails);
  return { today, open, dueSoon, overdue, failed };
}

async function inScopeParts(db: Db): Promise<Map<string, string | null>> {
  const plans = await db.select().from(faiInspectionPlans).where(isNull(faiInspectionPlans.retiredAt));
  const sources = await db.select({ partNumber: faiSourceApprovals.partNumber }).from(faiSourceApprovals);
  const parts = new Map<string, string | null>();
  for (const plan of plans) {
    if (plan.scope === "part" && plan.partNumber) parts.set(plan.partNumber, plan.partName);
  }
  for (const source of sources) {
    if (!parts.has(source.partNumber)) parts.set(source.partNumber, null);
  }
  return parts;
}

export async function listPulls(db: Db) {
  const today = await companyToday(db);
  const timeZone = safeTimeZone((await db.select({ profile: company.profile }).from(company).limit(1))[0]?.profile?.timezone);
  const parts = await inScopeParts(db);
  const pulls = await db.select().from(faiAnnualPulls).orderBy(desc(faiAnnualPulls.createdAt));
  const due = [];
  for (const [partNumber, partName] of parts) {
    const rows = pulls.filter((row) => row.partNumber === partNumber);
    const completed = rows.filter((row) => row.completedAt).sort((left, right) => right.completedAt!.getTime() - left.completedAt!.getTime());
    const last = completed[0];
    const lastOn = last?.completedAt ? calendarDay(last.completedAt, timeZone) : null;
    if (!needsAnnualPull(lastOn, today)) continue;
    const open = rows.find((row) => !row.completedAt);
    due.push({
      partNumber,
      partName,
      lastCompletedOn: lastOn,
      openPullId: open?.id ?? null,
      assignedTo: open?.assignedTo ?? null,
    });
  }
  due.sort((left, right) => left.partNumber.localeCompare(right.partNumber));
  return { today, due };
}

export async function assignPull(db: Db, actor: FaiActor & { id: number }, body: PullAssignBody) {
  if (!canApproveFai(actor)) throw AppError.forbidden("The yearly pull list is a Quality action.");
  const userId = actor.id;
  const parts = await inScopeParts(db);
  const partNumber = body.partNumber.trim();
  if (!parts.has(partNumber)) throw AppError.badRequest("That part is not on an active inspection plan or source list.");
  const assignee = await loadPerson(db, body.userId);
  const [open] = await db.select().from(faiAnnualPulls).where(and(eq(faiAnnualPulls.partNumber, partNumber), isNull(faiAnnualPulls.completedAt))).limit(1);
  const now = new Date();
  const row = open
    ? (await db.update(faiAnnualPulls).set({ assignedTo: assignee.id, assignedAt: now }).where(eq(faiAnnualPulls.id, open.id)).returning())[0]
    : (await db.insert(faiAnnualPulls).values({ partNumber, assignedTo: assignee.id, assignedAt: now }).returning())[0];
  const who = await actorLabel(db, userId);
  const label = formatUserLabel(assignee, assignee.id);
  const text = noticePullAssigned(label, partNumber);
  await writeAudit(db, "FaiAnnualPull", row!.id, open ? "update" : "create", who, "Assigned annual pull", text, userId);
  await sendNotice(db, [assignee.email], text, "FaiAnnualPull", row!.id);
  return listPulls(db);
}

export async function completePull(req: Request, body: PullCompleteBody) {
  const db = req.db!;
  const actor = actorFrom(req);
  const partNumber = body.partNumber.trim();
  const parts = await inScopeParts(db);
  if (!parts.has(partNumber)) throw AppError.badRequest("That part is not on an active inspection plan or source list.");
  const [open] = await db.select().from(faiAnnualPulls).where(and(eq(faiAnnualPulls.partNumber, partNumber), isNull(faiAnnualPulls.completedAt))).limit(1);
  if (!canRecordAnnualPull(actor, open?.assignedTo ?? null)) throw AppError.forbidden("Quality records the annual pull, or the person it was assigned to.");
  if (body.faiId) {
    const linked = await loadRecord(db, body.faiId);
    if (linked.partNumber !== partNumber) throw AppError.badRequest("That first article is for a different part.");
  }
  const now = new Date();
  const row = open
    ? (await db.update(faiAnnualPulls).set({ completedAt: now, completedBy: actor.id, faiId: body.faiId ?? open.faiId, notes: cleanText(body.notes) ?? open.notes }).where(eq(faiAnnualPulls.id, open.id)).returning())[0]
    : (await db.insert(faiAnnualPulls).values({ partNumber, completedAt: now, completedBy: actor.id, faiId: body.faiId ?? null, notes: cleanText(body.notes) }).returning())[0];
  const who = await actorLabel(db, actor.id);
  const text = noticePullRecorded(partNumber);
  await writeAudit(db, "FaiAnnualPull", row!.id, "status_change", who, "Recorded annual pull", text, actor.id);
  const recipients = [...(await qualityEmails(db)), ...(open?.assignedTo ? await activeEmails(db, [open.assignedTo]) : [])];
  await sendNotice(db, recipients, text, "FaiAnnualPull", row!.id);
  return listPulls(db);
}

