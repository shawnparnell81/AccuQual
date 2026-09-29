import { unlink } from "node:fs/promises";
import type { Request } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import { scheduleAfterCommit, type Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { canDeleteAnyRecord } from "../roles/roleAccess.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { liftHold, type HoldTarget } from "../inventory/inventoryHolds.service.js";
import { attachments } from "../../drizzle/schema/attachments.js";
import { formData, formVersions } from "../../drizzle/schema/forms.js";
import { ncr, ncrAttachments } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { validationReports } from "../../drizzle/schema/validationReport.js";
import { documents, documentFiles, documentVersions } from "../../drizzle/schema/documents.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { audits, auditItems } from "../../drizzle/schema/audits.js";
import { quarantineInventory, quarantineRecords, quarantineResolutions, type QuarantineRecord } from "../../drizzle/schema/quarantine.js";
import { suppliers, supplierScorecards } from "../../drizzle/schema/supplier.js";
import {
  supplier8dResponses,
  supplierCorrectiveActions,
  supplierDocuments,
  supplierMessages,
  supplierOnboardingDocuments,
  supplierPpapSubmissions,
} from "../../drizzle/schema/supplierPortal.js";
import { supplierQualityRiskScores } from "../../drizzle/schema/supplierQualityRisk.js";
import { rmaActivityLog, supplierRmaRequests } from "../../drizzle/schema/supplierRma.js";
import { erpPurchaseOrders, erpPurchaseRequisitions } from "../../drizzle/schema/erp.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { inventoryLots } from "../../drizzle/schema/inventoryLots.js";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { warrantyClaimCosts, warrantyClaims, warrantyClaimWorkflow } from "../../drizzle/schema/warranty.js";
import { qualityInspectionItems, qualityInspectionReports } from "../../drizzle/schema/qualityInspectionReports.js";
import { users } from "../../drizzle/schema/users.js";
import { rma, rmaItems } from "../../drizzle/schema/rma.js";
import { workOrderOperations, workOrders } from "../../drizzle/schema/workOrders.js";
import { crarClaims } from "../../drizzle/schema/crar.js";
import { rmaLogRecords } from "../../drizzle/schema/rmaLog.js";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { complaints } from "../../drizzle/schema/complaints.js";
import { changeRequests } from "../../drizzle/schema/change.js";
import { ppapPackages } from "../../drizzle/schema/ppap.js";
import { trainingAssignments, trainingCompetencies, trainingCourses, trainingSessions } from "../../drizzle/schema/training.js";
import { fmeaItems, riskAssessments, riskMitigations } from "../../drizzle/schema/risk.js";
import { qmsFormRows, qmsForms } from "../../drizzle/schema/qmsForms.js";
import { documentChangeItems, documentChangeRequests, documentChangeReviews } from "../../drizzle/schema/documentChangeRequests.js";
import { feasibilityReviews } from "../../drizzle/schema/feasibility.js";
import { calibrations, equipment } from "../../drizzle/schema/calibration.js";
import { isoQualityForms } from "../../drizzle/schema/isoQualityForms.js";
import { customers } from "../../drizzle/schema/customers.js";
import { salesQuotes } from "../../drizzle/schema/sales.js";

const OWNER_FIELDS = ["createdBy", "createdByUserId", "ownerId", "requestedBy", "auditorId"] as const;

export type RecordKind =
  | "ncr"
  | "capa"
  | "eight_d"
  | "validation_report"
  | "document"
  | "audit"
  | "quarantine"
  | "supplier"
  | "risk"
  | "complaint"
  | "change"
  | "ppap"
  | "training"
  | "work_order"
  | "rma"
  | "warranty"
  | "crar"
  | "rma_log"
  | "quality"
  | "scar"
  | "qms"
  | "quality_inspection"
  | "dcr"
  | "feasibility"
  | "equipment"
  | "iso_quality_form";

type Row = Record<string, unknown>;

interface KindSpec {
  entityType: string;
  label: string;
  attachmentTypes: string[];
  formKeys: string[];
  numberFields?: string[];
  siteScoped?: boolean;
  title: (row: Row) => string | null;
  load: (db: Db, id: number) => Promise<Row | undefined>;
  beforeDelete?: (db: Db, row: Row) => Promise<void>;
  cleanup: (db: Db, row: Row, files: string[], actor?: number) => Promise<void>;
  remove: (db: Db, id: number) => Promise<void>;
}

export function deletionSummary(label: string, recordNumber: string | number, title: string | null | undefined): string {
  const trimmed = title?.trim();
  if (trimmed) return `Deleted ${label} #${recordNumber} "${trimmed}"`;
  return `Deleted ${label} #${recordNumber}`;
}

export function userMayDeleteRecord(roleName: string | null | undefined, userId: number | undefined, owners: number[]): boolean {
  if (canDeleteAnyRecord(roleName)) return true;
  return userId != null && owners.includes(userId);
}

function ownerIdsOf(row: Row): number[] {
  const ids: number[] = [];
  for (const key of OWNER_FIELDS) {
    const value = row[key];
    if (typeof value === "number") ids.push(value);
  }
  return ids;
}

function textOf(row: Row, keys: string[], max = 160): string | null {
  for (const key of keys) {
    const value = row[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, max);
    if (typeof value === "number") return String(value);
  }
  return null;
}

function recordNumberOf(row: Row, fields: string[] | undefined): string {
  const fromField = textOf(row, fields ?? []);
  if (fromField) return fromField;
  return String(row.id);
}

function jsonSnapshot(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (_key, item) => (item instanceof Date ? item.toISOString() : item)));
}

function fkCode(err: unknown): string | undefined {
  const error = err as { code?: string; cause?: { code?: string } };
  return error.code ?? error.cause?.code;
}

async function unlinkQuiet(path: string) {
  await unlink(path).catch(() => undefined);
}

function scheduleUnlink(req: Request, paths: string[]) {
  const unique = [...new Set(paths.filter((path) => path.trim() !== ""))];
  if (unique.length === 0) return;
  scheduleAfterCommit(req, async () => {
    await Promise.all(unique.map((path) => unlinkQuiet(path)));
  });
}

async function loadOne(db: Db, table: PgTable, idColumn: PgColumn, id: number): Promise<Row | undefined> {
  const rows = await db.select().from(table).where(eq(idColumn, id));
  return rows[0] as Row | undefined;
}

async function removeWhere(db: Db, table: PgTable, column: PgColumn, id: number) {
  await db.delete(table).where(eq(column, id));
}

function columnKey(table: PgTable, column: PgColumn): string {
  const key = Object.keys(table).find((name) => (table as unknown as Record<string, unknown>)[name] === column);
  if (!key) throw new Error(`Unknown column ${column.name}`);
  return key;
}

async function clearLink(db: Db, table: PgTable, column: PgColumn, id: number) {
  await db.update(table).set({ [columnKey(table, column)]: null } as never).where(eq(column, id));
}

async function detachAttachments(db: Db, entityTypes: string[], entityId: number): Promise<{ names: string[]; paths: string[] }> {
  if (entityTypes.length === 0) return { names: [], paths: [] };
  const rows = await db
    .select()
    .from(attachments)
    .where(and(inArray(attachments.entityType, entityTypes), eq(attachments.entityId, entityId)));
  if (rows.length === 0) return { names: [], paths: [] };
  await db.delete(attachments).where(inArray(attachments.id, rows.map((row) => row.id)));
  return { names: rows.map((row) => row.fileName), paths: rows.map((row) => row.filePath) };
}

async function removeLinkedForms(db: Db, entityId: number, keys: string[]) {
  if (keys.length === 0) return [];
  const rows = await db
    .select()
    .from(formData)
    .where(and(eq(formData.entityId, entityId), or(inArray(formData.entityType, keys), inArray(formData.formType, keys))));
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  await db.delete(formVersions).where(inArray(formVersions.formId, ids));
  await db.delete(formData).where(inArray(formData.id, ids));
  return rows.map((row) => ({ id: row.id, formType: row.formType, entityType: row.entityType }));
}

function holdTarget(record: QuarantineRecord): HoldTarget | null {
  if (!record.enforced) return null;
  const target = (record.metadata as { target?: HoldTarget } | null)?.target;
  return target ?? null;
}

async function deleteQuarantineRow(db: Db, record: QuarantineRecord, actor?: number) {
  if (record.status === "quarantined") {
    const target = holdTarget(record);
    if (target) {
      await liftHold(db, target, Number(record.quantity), { quarantineId: record.id, reason: "Quarantine record deleted" }, actor);
    }
  }
  await removeWhere(db, quarantineResolutions, quarantineResolutions.quarantineId, record.id);
  await removeWhere(db, quarantineInventory, quarantineInventory.quarantineId, record.id);
  await removeWhere(db, quarantineRecords, quarantineRecords.id, record.id);
}

async function deleteNcrQuarantineChildren(db: Db, ncrId: number, files: string[], actor?: number) {
  const sourced = await db
    .select()
    .from(quarantineRecords)
    .where(and(eq(quarantineRecords.sourceType, "ncr"), eq(quarantineRecords.sourceId, ncrId)));
  for (const record of sourced) {
    const attached = await detachAttachments(db, ["quarantine"], record.id);
    files.push(...attached.paths);
    await deleteQuarantineRow(db, record, actor);
  }
  await clearLink(db, quarantineRecords, quarantineRecords.ncrId, ncrId);
}

function collectStoredPaths(value: unknown, out: string[]) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) collectStoredPaths(item, out);
    return;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.filePath === "string") out.push(record.filePath);
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectStoredPaths(nested, out);
  }
}

async function deleteSupplierOwned(db: Db, supplierId: number, files: string[]) {
  const [orders] = await db.select({ id: erpPurchaseOrders.id }).from(erpPurchaseOrders).where(eq(erpPurchaseOrders.supplierId, supplierId)).limit(1);
  const [returns] = await db.select({ id: rma.id }).from(rma).where(eq(rma.supplierId, supplierId)).limit(1);
  if (orders || returns) {
    throw new AppError("This supplier still has purchase orders or RMAs. Remove those before deleting the supplier.", 409);
  }

  const onboarding = await db.select().from(supplierOnboardingDocuments).where(eq(supplierOnboardingDocuments.supplierId, supplierId));
  const library = await db.select().from(supplierDocuments).where(eq(supplierDocuments.supplierId, supplierId));
  const ppap = await db.select().from(supplierPpapSubmissions).where(eq(supplierPpapSubmissions.supplierId, supplierId));
  const actions = await db.select().from(supplierCorrectiveActions).where(eq(supplierCorrectiveActions.supplierId, supplierId));
  const responses = await db.select().from(supplier8dResponses).where(eq(supplier8dResponses.supplierId, supplierId));
  const messages = await db.select().from(supplierMessages).where(eq(supplierMessages.supplierId, supplierId));
  for (const row of onboarding) files.push(row.filePath);
  for (const row of library) files.push(row.filePath);
  for (const row of [...ppap, ...actions, ...responses, ...messages]) collectStoredPaths(row, files);

  const requests = await db.select({ id: supplierRmaRequests.id }).from(supplierRmaRequests).where(eq(supplierRmaRequests.supplierId, supplierId));
  const requestIds = requests.map((row) => row.id);
  if (requestIds.length > 0) {
    await db.update(crarClaims).set({ supplierRmaRequestId: null }).where(inArray(crarClaims.supplierRmaRequestId, requestIds));
    await db.update(rmaLogRecords).set({ supplierRmaRequestId: null }).where(inArray(rmaLogRecords.supplierRmaRequestId, requestIds));
    await db.delete(rmaActivityLog).where(inArray(rmaActivityLog.supplierRmaRequestId, requestIds));
    await db.delete(supplierRmaRequests).where(inArray(supplierRmaRequests.id, requestIds));
  }

  await removeWhere(db, supplierMessages, supplierMessages.supplierId, supplierId);
  await removeWhere(db, supplier8dResponses, supplier8dResponses.supplierId, supplierId);
  await removeWhere(db, supplierCorrectiveActions, supplierCorrectiveActions.supplierId, supplierId);
  await removeWhere(db, supplierPpapSubmissions, supplierPpapSubmissions.supplierId, supplierId);
  await removeWhere(db, supplierDocuments, supplierDocuments.supplierId, supplierId);
  await removeWhere(db, supplierOnboardingDocuments, supplierOnboardingDocuments.supplierId, supplierId);
  await removeWhere(db, supplierScorecards, supplierScorecards.supplierId, supplierId);
  await removeWhere(db, supplierQualityRiskScores, supplierQualityRiskScores.supplierId, supplierId);

  await clearLink(db, ncr, ncr.supplierId, supplierId);
  await clearLink(db, capa, capa.supplierId, supplierId);
  await clearLink(db, inventoryItems, inventoryItems.defaultSupplierId, supplierId);
  await clearLink(db, inventoryLots, inventoryLots.supplierId, supplierId);
  await clearLink(db, scarForms, scarForms.supplierId, supplierId);
  await clearLink(db, warrantyClaims, warrantyClaims.supplierId, supplierId);
  await clearLink(db, qualityInspectionReports, qualityInspectionReports.supplierId, supplierId);
  await clearLink(db, erpPurchaseRequisitions, erpPurchaseRequisitions.supplierId, supplierId);
  await clearLink(db, users, users.supplierId, supplierId);
}

async function deleteDocumentOwned(db: Db, documentId: number, files: string[]) {
  await db.update(documents).set({ currentVersionId: null }).where(eq(documents.id, documentId));
  const filesOnDisk = await db.select().from(documentFiles).where(eq(documentFiles.documentId, documentId));
  for (const file of filesOnDisk) files.push(file.filePath);
  await removeWhere(db, documentFiles, documentFiles.documentId, documentId);
  await removeWhere(db, documentVersions, documentVersions.documentId, documentId);
  await db.delete(controlledVersions).where(and(eq(controlledVersions.subjectType, "document"), eq(controlledVersions.subjectId, documentId)));
  await clearLink(db, documentFolders, documentFolders.documentId, documentId);
  await clearLink(db, trainingCourses, trainingCourses.documentId, documentId);
  await clearLink(db, customers, customers.ndaDocumentId, documentId);
  await clearLink(db, salesQuotes, salesQuotes.pricingSheetDocumentId, documentId);
}

function eightDTitle(row: Row): string | null {
  const data = row.data;
  if (!data || typeof data !== "object") return null;
  return textOf(data as Row, ["part_number", "partNumber", "part", "d2_problem", "customer"]);
}

function validationTitle(row: Row): string | null {
  const data = row.data;
  if (!data || typeof data !== "object") return null;
  const cells = (data as { cells?: Row }).cells;
  if (!cells) return null;
  return textOf(cells, ["B6"]);
}

function validationLabel(row: Row): string {
  const data = row.data;
  if (data && typeof data === "object" && (data as { formType?: unknown }).formType === "fuel_pump") return "Fuel Pump Validation";
  return "Validation Report";
}

const specs: Record<RecordKind, KindSpec> = {
  ncr: {
    entityType: "NCR",
    label: "NCR",
    attachmentTypes: ["ncr"],
    formKeys: ["ncr"],
    siteScoped: true,
    title: (row) => textOf(row, ["title"]),
    load: (db, id) => loadOne(db, ncr, ncr.id, id),
    cleanup: async (db, row, files, actor) => {
      const id = row.id as number;
      const legacy = await db.select().from(ncrAttachments).where(eq(ncrAttachments.ncrId, id));
      for (const file of legacy) if (file.fileUrl) files.push(file.fileUrl);
      await removeWhere(db, ncrAttachments, ncrAttachments.ncrId, id);
      await deleteNcrQuarantineChildren(db, id, files, actor);
      await clearLink(db, capa, capa.ncrId, id);
      await clearLink(db, eightD, eightD.ncrId, id);
      await clearLink(db, supplierCorrectiveActions, supplierCorrectiveActions.linkedNcrId, id);
      await clearLink(db, supplier8dResponses, supplier8dResponses.linkedNcrId, id);
      await clearLink(db, warrantyClaims, warrantyClaims.linkedNcrId, id);
      await clearLink(db, rma, rma.linkedNcrId, id);
      await clearLink(db, workOrders, workOrders.linkedNcrId, id);
      await clearLink(db, erpPurchaseRequisitions, erpPurchaseRequisitions.linkedNcrId, id);
      await clearLink(db, crarClaims, crarClaims.qualityId, id);
      await clearLink(db, rmaLogRecords, rmaLogRecords.qualityId, id);
    },
    remove: (db, id) => removeWhere(db, ncr, ncr.id, id),
  },
  capa: {
    entityType: "CAPA",
    label: "CAPA",
    attachmentTypes: ["capa"],
    formKeys: ["capa"],
    siteScoped: true,
    title: (row) => textOf(row, ["actionPlan", "rootCause"]),
    load: (db, id) => loadOne(db, capa, capa.id, id),
    cleanup: async (db, row) => {
      const id = row.id as number;
      await clearLink(db, rma, rma.linkedCapaId, id);
      await clearLink(db, supplierCorrectiveActions, supplierCorrectiveActions.linkedCapaId, id);
    },
    remove: (db, id) => removeWhere(db, capa, capa.id, id),
  },
  eight_d: {
    entityType: "8D Report",
    label: "8D",
    attachmentTypes: ["eight_d"],
    formKeys: ["eight_d"],
    title: eightDTitle,
    load: (db, id) => loadOne(db, eightD, eightD.id, id),
    cleanup: async (db, row) => {
      await clearLink(db, supplier8dResponses, supplier8dResponses.linkedEightDId, row.id as number);
    },
    remove: (db, id) => removeWhere(db, eightD, eightD.id, id),
  },
  validation_report: {
    entityType: "Validation Report",
    label: "Validation Report",
    attachmentTypes: ["validation_report"],
    formKeys: ["validation_report"],
    title: validationTitle,
    load: (db, id) => loadOne(db, validationReports, validationReports.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, validationReports, validationReports.id, id),
  },
  document: {
    entityType: "Document",
    label: "Document",
    attachmentTypes: ["document", "documents"],
    formKeys: ["document"],
    title: (row) => textOf(row, ["title"]),
    load: (db, id) => loadOne(db, documents, documents.id, id),
    cleanup: (db, row, files) => deleteDocumentOwned(db, row.id as number, files),
    remove: (db, id) => removeWhere(db, documents, documents.id, id),
  },
  audit: {
    entityType: "Audit",
    label: "Audit",
    attachmentTypes: ["audit", "audits"],
    formKeys: ["audit", "audits", "audit_plan", "audit_checklist", "lpa"],
    siteScoped: true,
    title: (row) => textOf(row, ["name"]),
    load: (db, id) => loadOne(db, audits, audits.id, id),
    cleanup: async (db, row) => {
      const id = row.id as number;
      const items = await db.select({ id: auditItems.id }).from(auditItems).where(eq(auditItems.auditId, id));
      if (items.length > 0) {
        await db.update(discrepancyInvestigations).set({ sourceAuditItemId: null }).where(inArray(discrepancyInvestigations.sourceAuditItemId, items.map((item) => item.id)));
      }
      await db.update(discrepancyInvestigations).set({ sourceAuditId: null }).where(eq(discrepancyInvestigations.sourceAuditId, id));
      await removeWhere(db, auditItems, auditItems.auditId, id);
    },
    remove: (db, id) => removeWhere(db, audits, audits.id, id),
  },
  quarantine: {
    entityType: "Quarantine",
    label: "Quarantine",
    attachmentTypes: ["quarantine"],
    formKeys: ["quarantine"],
    title: (row) => textOf(row, ["itemLabel"]),
    load: (db, id) => loadOne(db, quarantineRecords, quarantineRecords.id, id),
    cleanup: async (db, row, _files, actor) => {
      await deleteQuarantineRow(db, row as unknown as QuarantineRecord, actor);
    },
    remove: async () => undefined,
  },
  supplier: {
    entityType: "Supplier",
    label: "Supplier",
    attachmentTypes: ["suppliers", "supplier"],
    formKeys: ["supplier", "suppliers"],
    title: (row) => textOf(row, ["name"]),
    load: (db, id) => loadOne(db, suppliers, suppliers.id, id),
    cleanup: (db, row, files) => deleteSupplierOwned(db, row.id as number, files),
    remove: (db, id) => removeWhere(db, suppliers, suppliers.id, id),
  },
  risk: {
    entityType: "RiskAssessment",
    label: "Risk",
    attachmentTypes: ["risk"],
    formKeys: ["risk", "fmea"],
    title: (row) => textOf(row, ["title"]),
    load: (db, id) => loadOne(db, riskAssessments, riskAssessments.id, id),
    cleanup: async (db, row) => {
      const id = row.id as number;
      await removeWhere(db, riskMitigations, riskMitigations.riskAssessmentId, id);
      await removeWhere(db, fmeaItems, fmeaItems.riskAssessmentId, id);
    },
    remove: (db, id) => removeWhere(db, riskAssessments, riskAssessments.id, id),
  },
  complaint: {
    entityType: "Complaint",
    label: "Complaint",
    attachmentTypes: ["complaint", "complaints"],
    formKeys: ["complaint"],
    title: (row) => textOf(row, ["customerName", "description"]),
    load: (db, id) => loadOne(db, complaints, complaints.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, complaints, complaints.id, id),
  },
  change: {
    entityType: "Change request",
    label: "Change request",
    attachmentTypes: ["change"],
    formKeys: ["change", "pcn"],
    title: (row) => textOf(row, ["title"]),
    load: (db, id) => loadOne(db, changeRequests, changeRequests.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, changeRequests, changeRequests.id, id),
  },
  ppap: {
    entityType: "PPAP package",
    label: "PPAP",
    attachmentTypes: ["ppap"],
    formKeys: ["ppap", "control_plan", "appearance_approval", "apqp_summary", "dimensional_report", "process_flow_diagram", "dvpr", "final_inspection_release_checklist"],
    title: (row) => textOf(row, ["partNumber", "partName"]),
    load: (db, id) => loadOne(db, ppapPackages, ppapPackages.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, ppapPackages, ppapPackages.id, id),
  },
  training: {
    entityType: "TrainingCourse",
    label: "Training course",
    attachmentTypes: ["training"],
    formKeys: ["training"],
    title: (row) => textOf(row, ["title"]),
    load: (db, id) => loadOne(db, trainingCourses, trainingCourses.id, id),
    cleanup: async (db, row, files) => {
      const id = row.id as number;
      const assignments = await db.select().from(trainingAssignments).where(eq(trainingAssignments.courseId, id));
      for (const assignment of assignments) if (assignment.certificatePath) files.push(assignment.certificatePath);
      await removeWhere(db, trainingCompetencies, trainingCompetencies.courseId, id);
      await removeWhere(db, trainingAssignments, trainingAssignments.courseId, id);
      await removeWhere(db, trainingSessions, trainingSessions.courseId, id);
    },
    remove: (db, id) => removeWhere(db, trainingCourses, trainingCourses.id, id),
  },
  work_order: {
    entityType: "WorkOrder",
    label: "Work order",
    attachmentTypes: ["work_order", "work_orders"],
    formKeys: ["work_order", "maintenance_work_order"],
    title: () => null,
    load: (db, id) => loadOne(db, workOrders, workOrders.id, id),
    cleanup: async (db, row) => {
      const id = row.id as number;
      await clearLink(db, warrantyClaims, warrantyClaims.linkedWorkOrderId, id);
      await removeWhere(db, workOrderOperations, workOrderOperations.workOrderId, id);
    },
    remove: (db, id) => removeWhere(db, workOrders, workOrders.id, id),
  },
  rma: {
    entityType: "Rma",
    label: "RMA",
    attachmentTypes: ["rma"],
    formKeys: ["rma"],
    numberFields: ["rmaNumber"],
    title: () => null,
    load: (db, id) => loadOne(db, rma, rma.id, id),
    cleanup: async (db, row) => {
      const id = row.id as number;
      await clearLink(db, supplierRmaRequests, supplierRmaRequests.createdRmaId, id);
      await clearLink(db, rmaActivityLog, rmaActivityLog.rmaId, id);
      await clearLink(db, crarClaims, crarClaims.linkedRmaId, id);
      await removeWhere(db, rmaItems, rmaItems.rmaId, id);
    },
    remove: (db, id) => removeWhere(db, rma, rma.id, id),
  },
  warranty: {
    entityType: "WarrantyClaim",
    label: "Warranty claim",
    attachmentTypes: ["warranty_claim", "warranty"],
    formKeys: ["warranty", "warranty_claim"],
    numberFields: ["claimNumber"],
    title: (row) => textOf(row, ["failureDescription"]),
    load: (db, id) => loadOne(db, warrantyClaims, warrantyClaims.id, id),
    cleanup: async (db, row) => {
      const id = row.id as number;
      await clearLink(db, crarClaims, crarClaims.warrantyId, id);
      await clearLink(db, rmaLogRecords, rmaLogRecords.warrantyId, id);
      await removeWhere(db, warrantyClaimCosts, warrantyClaimCosts.claimId, id);
      await removeWhere(db, warrantyClaimWorkflow, warrantyClaimWorkflow.claimId, id);
    },
    remove: (db, id) => removeWhere(db, warrantyClaims, warrantyClaims.id, id),
  },
  crar: {
    entityType: "Crar",
    label: "CRAR",
    attachmentTypes: ["crar"],
    formKeys: ["crar"],
    numberFields: ["rmaNumber"],
    title: (row) => textOf(row, ["customerName", "partNumber"]),
    load: (db, id) => loadOne(db, crarClaims, crarClaims.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, crarClaims, crarClaims.id, id),
  },
  rma_log: {
    entityType: "RmaLog",
    label: "RMA log",
    attachmentTypes: ["rma_log"],
    formKeys: ["rma_log"],
    numberFields: ["rmaNumber"],
    title: (row) => textOf(row, ["customerName", "partNumber"]),
    load: (db, id) => loadOne(db, rmaLogRecords, rmaLogRecords.id, id),
    cleanup: async (db, row) => {
      await clearLink(db, crarClaims, crarClaims.rmaLogId, row.id as number);
    },
    remove: (db, id) => removeWhere(db, rmaLogRecords, rmaLogRecords.id, id),
  },
  quality: {
    entityType: "Discrepancy investigation",
    label: "Discrepancy",
    attachmentTypes: ["quality", "di"],
    formKeys: ["di", "discrepancy_inspection"],
    title: (row) => textOf(row, ["title"]),
    load: (db, id) => loadOne(db, discrepancyInvestigations, discrepancyInvestigations.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, discrepancyInvestigations, discrepancyInvestigations.id, id),
  },
  scar: {
    entityType: "ScarForm",
    label: "SCAR",
    attachmentTypes: ["scar"],
    formKeys: ["scar"],
    numberFields: ["scarNumber"],
    title: (row) => textOf(row, ["supplierName", "partNumberDescription"]),
    load: (db, id) => loadOne(db, scarForms, scarForms.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, scarForms, scarForms.id, id),
  },
  qms: {
    entityType: "QmsForm",
    label: "QMS form",
    attachmentTypes: ["qms_form", "qms"],
    formKeys: ["qms", "qms_form"],
    numberFields: ["formNo"],
    title: (row) => textOf(row, ["formType"]),
    load: (db, id) => loadOne(db, qmsForms, qmsForms.id, id),
    cleanup: async (db, row) => {
      await removeWhere(db, qmsFormRows, qmsFormRows.formId, row.id as number);
    },
    remove: (db, id) => removeWhere(db, qmsForms, qmsForms.id, id),
  },
  quality_inspection: {
    entityType: "QualityInspectionReport",
    label: "Quality inspection",
    attachmentTypes: ["quality_inspection"],
    formKeys: ["quality_inspection"],
    title: (row) => textOf(row, ["partMaterialNo", "inspectorName"]),
    load: (db, id) => loadOne(db, qualityInspectionReports, qualityInspectionReports.id, id),
    cleanup: async (db, row) => {
      await removeWhere(db, qualityInspectionItems, qualityInspectionItems.reportId, row.id as number);
    },
    remove: (db, id) => removeWhere(db, qualityInspectionReports, qualityInspectionReports.id, id),
  },
  dcr: {
    entityType: "DocumentChangeRequest",
    label: "Document change request",
    attachmentTypes: ["document_change_request", "dcr"],
    formKeys: ["document_change_request"],
    numberFields: ["formNo"],
    title: () => null,
    load: (db, id) => loadOne(db, documentChangeRequests, documentChangeRequests.id, id),
    cleanup: async (db, row) => {
      const id = row.id as number;
      await removeWhere(db, documentChangeItems, documentChangeItems.documentChangeRequestId, id);
      await removeWhere(db, documentChangeReviews, documentChangeReviews.documentChangeRequestId, id);
    },
    remove: (db, id) => removeWhere(db, documentChangeRequests, documentChangeRequests.id, id),
  },
  feasibility: {
    entityType: "FeasibilityReview",
    label: "Feasibility review",
    attachmentTypes: ["feasibility"],
    formKeys: ["feasibility"],
    title: (row) => textOf(row, ["partProjectName", "customerName"]),
    load: (db, id) => loadOne(db, feasibilityReviews, feasibilityReviews.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, feasibilityReviews, feasibilityReviews.id, id),
  },
  equipment: {
    entityType: "Equipment",
    label: "Equipment",
    attachmentTypes: ["calibration", "equipment"],
    formKeys: ["calibration", "gage_rr", "maintenance_work_order"],
    title: (row) => textOf(row, ["name"]),
    load: (db, id) => loadOne(db, equipment, equipment.id, id),
    beforeDelete: async (db, row) => {
      const [history] = await db.select({ id: calibrations.id }).from(calibrations).where(eq(calibrations.equipmentId, row.id as number)).limit(1);
      if (history) {
        throw AppError.badRequest("This equipment has recorded calibration history and cannot be deleted. Remove its calibration records first if it must go.");
      }
    },
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, equipment, equipment.id, id),
  },
  iso_quality_form: {
    entityType: "ISO form",
    label: "ISO form",
    attachmentTypes: ["iso_quality_form"],
    formKeys: ["iso_quality_form"],
    title: (row) => isoFormTitle(row),
    load: (db, id) => loadOne(db, isoQualityForms, isoQualityForms.id, id),
    cleanup: async () => undefined,
    remove: (db, id) => removeWhere(db, isoQualityForms, isoQualityForms.id, id),
  },
};

const ISO_FORM_LABELS: Record<string, string> = {
  internal_audit: "Internal Audit Checklist",
  ncr_report: "Non-Conformance Report",
  quarantine_notice: "Quarantine Notice",
  concession: "Concession / Deviation Request",
  competency_training: "Competency and Training Record",
  cross_training: "Cross-Training Evaluation",
  psw: "Part Submission Warrant",
  turtle_diagram: "Turtle Diagram",
  quality_alert: "Quality Alert",
  first_article: "First Article Inspection Report",
  customer_scorecard: "Customer Scorecard",
  failure_effectiveness: "Failure Action Effectiveness Chart",
};

function isoFormTitle(row: Row): string | null {
  const data = row.data as { cells?: Record<string, unknown> } | undefined;
  const cells = data?.cells ?? {};
  for (const key of ["B3", "B5", "D2", "F3", "B2", "D4"]) {
    const value = cells[key];
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 160);
  }
  return null;
}

function isoFormLabel(row: Row): string {
  return ISO_FORM_LABELS[String(row.formType ?? "")] ?? "ISO form";
}

export async function deleteRecord(req: Request, kind: RecordKind): Promise<void> {
  if (!req.db || !req.user) throw AppError.unauthorized("Not signed in");
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Invalid id");
  const spec = specs[kind];
  const row = await spec.load(req.db, id);
  if (!row) throw AppError.notFound(spec.label);

  if (!userMayDeleteRecord(req.user.roleName, req.user.id, ownerIdsOf(row))) {
    throw AppError.forbidden("You don't have permission to delete this record.");
  }
  if (spec.siteScoped) {
    assertRecordOnAllowedSite(row.siteId as number | null | undefined, req.allowedSiteIds, spec.label);
  }
  if (spec.beforeDelete) await spec.beforeDelete(req.db, row);

  const files: string[] = [];
  try {
    const attached = await detachAttachments(req.db, spec.attachmentTypes, id);
    files.push(...attached.paths);
    const linkedForms = await removeLinkedForms(req.db, id, [...new Set([...spec.formKeys, ...spec.attachmentTypes])]);
    await spec.cleanup(req.db, row, files, req.user.id);
    await spec.remove(req.db, id);

    const title = spec.title(row);
    const recordNumber = recordNumberOf(row, spec.numberFields);
    const label = kind === "validation_report" ? validationLabel(row) : kind === "iso_quality_form" ? isoFormLabel(row) : spec.label;
    await recordAuditTrail(req.db, {
      entityType: spec.entityType,
      entityId: id,
      action: "delete",
      performedBy: req.user.id,
      changes: {
        summary: deletionSummary(label, recordNumber, title),
        title,
        recordNumber,
        snapshot: jsonSnapshot(row),
        attachmentFileNames: attached.names,
        linkedForms,
      },
    });
  } catch (err) {
    if (err instanceof AppError) throw err;
    if (fkCode(err) === "23503") throw new AppError("This record is still linked to other records and cannot be deleted.", 409);
    throw err;
  }

  scheduleUnlink(req, files);
}

export function deleteRecordHandler(kind: RecordKind) {
  return asyncHandler(async (req, res) => {
    await deleteRecord(req, kind);
    res.status(204).send();
  });
}
