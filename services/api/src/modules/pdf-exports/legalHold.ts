import { and, eq, isNull, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { legalHolds } from "../../drizzle/schema/pdfExports.js";
import { documents } from "../../drizzle/schema/documents.js";
import { formData } from "../../drizzle/schema/forms.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { FORM_TYPES } from "../forms/forms.validation.js";

/** Delete of this record also refuses a hold stored under one of these export types. */
const DELETE_HOLD_TYPES: Record<string, string[]> = {
  ncr: ["ncr", "five_why", "pareto_chart"],
  capa: ["capa"],
  eight_d: ["eight_d"],
  validation_report: ["validation_report"],
  document: ["document", "document_control_index"],
  audit: ["audit", "audit_checklist", "audit_plan", "lpa"],
  equipment: ["equipment", "calibration", "gage_rr", "maintenance_work_order"],
  quality: ["quality", "discrepancy_inspection", "di"],
  complaint: ["complaint", "complaints"],
  change: ["change", "pcn"],
  training: ["training", "competency_matrix"],
  risk: ["risk", "fmea"],
  ppap: ["ppap", "appearance_approval", "apqp_summary", "control_plan", "dimensional_report", "process_flow_diagram", "dvpr", "final_inspection_release_checklist"],
  supplier: ["supplier", "suppliers", "approved_vendor_list"],
};

/** Tables a hold can point at. Names are fixed here, never taken from the request. */
const RECORD_TABLES: Record<string, string> = {
  ncr: "ncr",
  capa: "capa",
  eight_d: "eight_d",
  validation_report: "validation_reports",
  document: "documents",
  fai: "fai_records",
  csa_fai: "csa_fai_records",
  fuel_pump_fai: "fuel_pump_fai_records",
  audit: "audits",
  equipment: "equipment",
  calibration: "equipment",
  quality: "discrepancy_investigations",
  di: "discrepancy_investigations",
  complaint: "complaints",
  complaints: "complaints",
  change: "change_requests",
  training: "training_courses",
  risk: "risk_assessments",
  fmea: "risk_assessments",
  ppap: "ppap_packages",
  supplier: "suppliers",
  suppliers: "suppliers",
  quarantine: "quarantine_records",
  scar: "scar_forms",
  work_order: "work_orders",
  work_orders: "work_orders",
  rma: "rma",
  warranty: "warranty_claims",
  warranty_claim: "warranty_claims",
  crar: "crar",
  rma_log: "rma_log",
  qms: "qms_forms",
  qms_form: "qms_forms",
  quality_inspection: "quality_inspection_reports",
  dcr: "document_change_requests",
  feasibility: "feasibility_reviews",
  iso_quality_form: "iso_quality_forms",
};

const AUDIT_ENTITY: Record<string, string> = {
  ncr: "NCR",
  five_why: "NCR",
  pareto_chart: "NCR",
  capa: "CAPA",
  eight_d: "8D Report",
  document: "Document",
  document_control_index: "Document",
  fai: "FaiRecord",
  csa_fai: "CsaFai",
  fuel_pump_fai: "FuelPumpFai",
  validation_report: "Validation Report",
  audit: "Audit",
  audit_checklist: "Audit",
  audit_plan: "Audit",
  lpa: "Audit",
};

const FORM_TYPE_SET = new Set<string>(FORM_TYPES);
const EXTRA_HOLD_TYPES = new Set(["fai", "csa_fai", "fuel_pump_fai", "validation_report", "document", "equipment", "quality", "quarantine"]);

export function holdTypesFor(kind: string): string[] {
  return DELETE_HOLD_TYPES[kind] ?? [kind];
}

export function retentionDeleteBlocked(held: boolean, action: "deleted" | "archived" | undefined): boolean {
  return held && action === "deleted";
}

export async function isOnLegalHold(db: Db, entityType: string, entityId: number): Promise<boolean> {
  const [row] = await db
    .select({ id: legalHolds.id })
    .from(legalHolds)
    .where(and(eq(legalHolds.entityType, entityType), eq(legalHolds.entityId, entityId), isNull(legalHolds.releasedAt)))
    .limit(1);
  return Boolean(row);
}

export async function recordIsOnLegalHold(db: Db, kind: string, entityId: number): Promise<boolean> {
  for (const entityType of holdTypesFor(kind)) {
    if (await isOnLegalHold(db, entityType, entityId)) return true;
  }
  return false;
}

export async function assertNotOnLegalHold(db: Db, kind: string, entityId: number): Promise<void> {
  if (await recordIsOnLegalHold(db, kind, entityId)) {
    throw new AppError("This record is under legal hold and cannot be deleted.", 409);
  }
}

export async function assertNotDestroyEligible(db: Db, documentId: number): Promise<void> {
  if (await isOnLegalHold(db, "document", documentId)) {
    throw new AppError("This record is under legal hold and cannot be marked for destruction.", 409);
  }
}

function ident(name: string): string {
  if (!/^[a-z_]+$/.test(name)) throw new Error(`Unexpected table name "${name}"`);
  return `"${name}"`;
}

async function recordExists(db: Db, entityType: string, entityId: number): Promise<boolean> {
  const table = RECORD_TABLES[entityType];
  if (table) {
    const found = await db.execute(sql.raw(`SELECT id FROM ${ident(table)} WHERE id = ${entityId} LIMIT 1`));
    const row = found.rows?.[0] as { id?: number } | undefined;
    if (row?.id != null) return true;
  }
  if (FORM_TYPE_SET.has(entityType)) {
    const [form] = await db
      .select({ id: formData.id })
      .from(formData)
      .where(and(eq(formData.formType, entityType), eq(formData.entityId, entityId)))
      .limit(1);
    if (form) return true;
  }
  if (entityType === "document") {
    const [doc] = await db.select({ id: documents.id }).from(documents).where(eq(documents.id, entityId)).limit(1);
    if (doc) return true;
  }
  return false;
}

function holdAllowed(entityType: string): boolean {
  return FORM_TYPE_SET.has(entityType) || EXTRA_HOLD_TYPES.has(entityType) || entityType in RECORD_TABLES;
}

async function writeHoldAudit(db: Db, entityType: string, entityId: number, actorId: number | undefined, description: string, reason?: string) {
  await recordAuditTrail(db, {
    entityType: AUDIT_ENTITY[entityType] ?? entityType,
    entityId,
    action: "status_change",
    changes: { event: "legal_hold", description, ...(reason ? { reason } : {}) },
    performedBy: actorId,
  });
}

export async function placeLegalHold(db: Db, entityType: string, entityId: number, actorId: number | undefined, reason?: string) {
  if (!holdAllowed(entityType)) throw AppError.badRequest("That record can't be placed on legal hold.");
  if (!(await recordExists(db, entityType, entityId))) throw AppError.notFound("Record");
  if (await isOnLegalHold(db, entityType, entityId)) throw new AppError("This record is already under legal hold.", 409);
  try {
    const [row] = await db
      .insert(legalHolds)
      .values({ entityType, entityId, placedBy: actorId, reason: reason?.trim() || null })
      .returning();
    await writeHoldAudit(db, entityType, entityId, actorId, "Placed legal hold", reason);
    return row!;
  } catch (err) {
    const code = (err as { code?: string; cause?: { code?: string } }).code ?? (err as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw new AppError("This record is already under legal hold.", 409);
    throw err;
  }
}

export async function releaseLegalHold(db: Db, entityType: string, entityId: number, actorId: number | undefined, reason?: string) {
  const [row] = await db
    .update(legalHolds)
    .set({ releasedBy: actorId, releasedAt: new Date() })
    .where(and(eq(legalHolds.entityType, entityType), eq(legalHolds.entityId, entityId), isNull(legalHolds.releasedAt)))
    .returning();
  if (!row) throw AppError.notFound("Legal hold");
  await writeHoldAudit(db, entityType, entityId, actorId, "Released legal hold", reason);
  return row;
}
