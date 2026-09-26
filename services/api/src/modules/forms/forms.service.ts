import { and, desc, eq } from "drizzle-orm";
import { formTemplates, formData, formVersions } from "../../drizzle/schema/forms.js";
import { AppError } from "../../utils/appError.js";
import type { Db } from "../../lib/requestDb.js";
import { mergePdfFields } from "./pdf-merger.js";

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
}

/** Auto-save path: updates the current row in place without snapshotting a version. */
export async function saveData(db: Db, input: SaveInput) {
  const existing = await loadData(db, input.formType, input.entityId);

  if (existing) {
    const [updated] = await db
      .update(formData)
      .set({ data: input.data, updatedAt: new Date() })
      .where(and(eq(formData.id, existing.id)))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(formData)
    .values({
      formType: input.formType,
      entityType: input.entityType,
      entityId: input.entityId,
      data: input.data,
      version: 1,
      createdBy: input.userId,
    })
    .returning();
  return created;
}

/** Deliberate snapshot: bumps `version` and writes an immutable form_versions row. */
export async function createVersion(db: Db, formId: number, userId?: number) {
  const [current] = await db.select().from(formData).where(and(eq(formData.id, formId)));
  if (!current) throw AppError.notFound("Form");

  const nextVersion = current.version + 1;
  await db.insert(formVersions).values({ formId, version: current.version, data: current.data, createdBy: userId });
  const [updated] = await db.update(formData).set({ version: nextVersion, updatedAt: new Date() }).where(eq(formData.id, formId)).returning();
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
    .orderBy(desc(formVersions.version));
}

export async function exportPdf(db: Db, formType: string, entityId?: number) {
  const template = await loadTemplate(db, formType);
  const current = await loadData(db, formType, entityId);
  if (!current) throw AppError.notFound("Form data");

  const pdfBytes = await mergePdfFields(template, current.data);
  return pdfBytes;
}
