import { and, desc, eq, inArray } from "drizzle-orm";
import { formTemplates, formData, formVersions } from "../../drizzle/schema/forms.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import type { Db } from "../../lib/requestDb.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { blank8dFromData } from "../eight-d/blank8dForm.js";
import { renderBlank8DPdf } from "../eight-d/blank8d-pdf.js";
import { mergePdfFields } from "./pdf-merger.js";
import { snapshotFormDataNumber } from "../document-folders/formRecordFiling.js";
import { answersWithTemplateStamp, readTemplateStamp, templateRevisionFor } from "./templateRevision.js";
import { retainSignatureValues } from "../signatures/signaturePin.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { attachments } from "../../drizzle/schema/attachments.js";
import { users } from "../../drizzle/schema/users.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { auditReason, emptyFrame, exportTrace, type AttachmentLine, type AuditLine, type ControlledPdfFrame } from "./controlledPdf.js";
import { applyChrome, loadPdfChrome, persistPdfExport } from "../pdf-exports/pdfExportStore.js";

/**
 * Self-healing (same pattern as document-folders.controller.ts's
 * ensureLibraryPool/ensureAdditionalSubfolders): platform.service.ts seeds
 * one default template per company at provisioning time from a fixed list,
 * but a form type added after a company was provisioned — or simply left off
 * that list by mistake (customer_requirements/inventory_item both were) —
 * had NO template row and 404'd on every Preview/Export PDF, forever, for
 * every company. That 404 also came back with no visible cause: exportFormPdf
 * uses `responseType: "arraybuffer"`, so the real JSON error body arrived as
 * raw bytes and extractErrorMessage silently fell back to its generic
 * caller-supplied text ("save it at least once first") regardless of what
 * actually failed — see useWorkflowAction.ts's own fix. Auto-provisioning
 * the default template here on first real use closes the gap for good,
 * without needing a one-off backfill script per company or a second list to
 * keep in sync with platform.service.ts's own.
 */
export async function loadTemplate(db: Db, formType: string) {
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.formType, formType)))
    .orderBy(desc(formTemplates.id)); // prefer a company-uploaded custom template over the seeded default if both exist
  if (template) return template;

  const [created] = await db.insert(formTemplates).values({ formType, pdfPath: `/templates/defaults/${formType}.pdf`, fieldMap: {}, isDefault: "true" }).returning();
  return created!;
}

/** Loads the current (highest-version) form_data row for an entity, or null if none exists yet. */
export async function loadData(db: Db, formType: string, entityId?: number) {
  const conditions = [eq(formData.formType, formType)];
  if (entityId !== undefined) conditions.push(eq(formData.entityId, entityId));

  const [row] = await db.select().from(formData).where(and(...conditions)).orderBy(desc(formData.id));
  return row ?? null;
}

interface SaveInput {
  formType: string;
  entityType?: string;
  entityId?: number;
  data: Record<string, unknown>;
  userId?: number;
  /** The signature endpoint already wrote the stamp. A normal save must not. */
  trustSignatures?: boolean;
}

/** Auto-save path: updates the current row in place without snapshotting a version. */
export async function saveData(db: Db, input: SaveInput) {
  const existing = await loadData(db, input.formType, input.entityId);
  const previous = (existing?.data ?? {}) as Record<string, unknown>;
  const signed = input.trustSignatures ? input.data : (retainSignatureValues(previous, input.data) as Record<string, unknown>);
  const data = answersWithTemplateStamp(`form:${input.formType}`, existing?.data, signed, !existing);

  if (existing) {
    // Answer saves keep the template revision this instance was filled against.
    const [updated] = await db
      .update(formData)
      .set({ data, updatedAt: new Date() })
      .where(and(eq(formData.id, existing.id)))
      .returning();
    return updated;
  }

  const stamp = readTemplateStamp(data) ?? templateRevisionFor(`form:${input.formType}`);
  const [created] = await db
    .insert(formData)
    .values({
      formType: input.formType,
      entityType: input.entityType,
      entityId: input.entityId,
      data,
      version: stamp.version,
      createdBy: input.userId,
    })
    .returning();
  if (created && input.entityId != null) await snapshotFormDataNumber(db, input.formType, input.entityId);
  return created;
}

/**
 * Snapshot of the filled answers. Does not change VERSION/REV: that identity
 * belongs to the form template, not to this save. Calibration and training
 * still use the call as their "finalize" action.
 */
export async function createVersion(db: Db, formId: number, userId?: number) {
  const [current] = await db.select().from(formData).where(and(eq(formData.id, formId)));
  if (!current) throw AppError.notFound("Form");

  const data = answersWithTemplateStamp(`form:${current.formType}`, current.data, current.data, false);
  await db.insert(formVersions).values({ formId, version: current.version, data: current.data, createdBy: userId });
  const [updated] = await db.update(formData).set({ data, updatedAt: new Date() }).where(eq(formData.id, formId)).returning();
  return updated;
}

/**
 * Read-only history: every past version's data, newest first. There is
 * deliberately no companion "restore this version" function here.
 *
 * Full-System Audit finding L5 — TODO (not planned/implemented): a real
 * rollback would need to snapshot the form's CURRENT state into
 * form_versions first (so rolling back is itself undoable, same
 * immutable-history guarantee createVersion already gives every other
 * save), then overwrite form_data.data with the chosen past version's data
 * and bump the version counter. Not built here — this finding is
 * documentation-only per its own scope.
 */
export async function listVersions(db: Db, formId: number) {
  return db
    .select()
    .from(formVersions)
    .where(and(eq(formVersions.formId, formId)))
    .orderBy(desc(formVersions.id));
}

/** What the form screen shows: the template revision this instance was filled against. */
export function presentForm<T extends { data: unknown }>(formType: string, row: T | null): (T & { templateRevision: string; templateVersion: number }) | null {
  if (!row) return null;
  const stamp = readTemplateStamp(row.data) ?? templateRevisionFor(`form:${formType}`);
  return { ...row, templateRevision: stamp.revision, templateVersion: stamp.version };
}

const PDF_AUDIT: Record<string, { audit: string; attachment: string }> = {
  ncr: { audit: "NCR", attachment: "ncr" },
  capa: { audit: "CAPA", attachment: "capa" },
};

function textOf(value: unknown): string {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function recordNumberFrom(formType: string, data: Record<string, unknown>, entityId?: number): string {
  for (const key of ["ncrNumber", "capaNumber", "number", "documentNumber", "faiNumber", "recordNumber"]) {
    const value = textOf(data[key]);
    if (value) return value;
  }
  if (formType === "ncr" && entityId) return `NCR-${entityId}`;
  if (formType === "capa" && entityId) return `CAPA-${entityId}`;
  return "";
}

async function namesFor(db: Db, ids: number[]): Promise<Map<number, string>> {
  const unique = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  if (unique.length === 0) return new Map();
  const rows = await db.select({ id: users.id, name: users.name }).from(users).where(inArray(users.id, unique));
  return new Map(rows.map((row) => [row.id, row.name?.trim() || ""]));
}

async function frameForForm(db: Db, formType: string, data: Record<string, unknown>, entityId: number | undefined, actorId: number | undefined): Promise<ControlledPdfFrame> {
  const stamp = readTemplateStamp(data) ?? templateRevisionFor(`form:${formType}`);
  const names = await namesFor(db, actorId ? [actorId] : []);
  const generatedBy = (actorId ? names.get(actorId) : "") || "AccuQual";
  const known = entityId != null ? PDF_AUDIT[formType] : undefined;
  let audit: AuditLine[] = [];
  let files: AttachmentLine[] = [];
  if (known && entityId != null) {
    const [history, filesRows] = await Promise.all([
      db
        .select({ action: auditTrail.action, changes: auditTrail.changes, performedBy: auditTrail.performedBy, createdAt: auditTrail.createdAt })
        .from(auditTrail)
        .where(and(eq(auditTrail.entityType, known.audit), eq(auditTrail.entityId, entityId)))
        .orderBy(desc(auditTrail.id))
        .limit(40),
      db
        .select({
          fileName: attachments.fileName,
          mimeType: attachments.mimeType,
          fileSize: attachments.fileSize,
          uploadedBy: attachments.uploadedBy,
          createdAt: attachments.createdAt,
        })
        .from(attachments)
        .where(and(eq(attachments.entityType, known.attachment), eq(attachments.entityId, entityId)))
        .orderBy(desc(attachments.id))
        .limit(40),
    ]);
    const who = await namesFor(db, [...history.map((row) => row.performedBy ?? 0), ...filesRows.map((row) => row.uploadedBy ?? 0)]);
    audit = history.map((row) => ({
      who: (row.performedBy ? who.get(row.performedBy) : "") || "Unknown",
      action: row.action,
      at: row.createdAt ? row.createdAt.toISOString().replace("T", " ").slice(0, 19) + " UTC" : "",
      reason: auditReason(row.changes),
    }));
    files = filesRows.map((row) => ({
      name: row.fileName,
      type: row.mimeType ?? "",
      size: row.fileSize != null ? `${row.fileSize} bytes` : "",
      uploadedBy: (row.uploadedBy ? who.get(row.uploadedBy) : "") || "",
      uploadedAt: row.createdAt ? row.createdAt.toISOString().slice(0, 10) : "",
    }));
  }
  return emptyFrame({
    sourceModule: formType,
    recordNumber: recordNumberFrom(formType, data, entityId),
    revision: stamp.revision,
    generatedBy,
    status: textOf(data.status) || textOf(data.documentStatus) || null,
    formNumber: textOf(data.formNumber) || null,
    audit,
    attachments: files,
  });
}

export async function exportPdf(db: Db, formType: string, entityId?: number, actorId?: number) {
  if (formType === "eight_d") {
    if (entityId == null) throw AppError.notFound("8D Report");
    const [row] = await db.select().from(eightD).where(eq(eightD.id, entityId));
    if (!row) throw AppError.notFound("8D Report");
    const bytes = await renderBlank8DPdf({ id: row.id, values: blank8dFromData((row.data ?? {}) as Record<string, unknown>) });
    return { bytes, exportId: "" };
  }

  const template = await loadTemplate(db, formType);
  const current = await loadData(db, formType, entityId);
  // A record can be printed before the form has been saved. A blank sheet
  // is still the form; refusing with "not found" left the Print button dead.
  const data = (current?.data ?? {}) as Record<string, unknown>;
  const built = await frameForForm(db, formType, data, entityId, actorId);
  const chrome = await loadPdfChrome(db, formType, entityId ?? null, data);
  const frame = applyChrome(built, chrome);
  const bytes = await mergePdfFields(template, data, frame);
  await persistPdfExport(db, bytes, frame, { entityType: formType, entityId: entityId ?? null, actorId });
  const known = entityId != null ? PDF_AUDIT[formType] : undefined;
  if (known && entityId != null) {
    try {
      await recordAuditTrail(db, {
        entityType: known.audit,
        entityId,
        action: "update",
        changes: { event: "pdf_export", ...exportTrace(bytes, frame) },
        performedBy: actorId,
      });
    } catch (err) {
      logger.warn("pdf export audit failed", err);
    }
  }
  return { bytes, exportId: frame.exportId };
}
