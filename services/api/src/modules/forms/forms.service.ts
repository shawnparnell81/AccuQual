import { and, desc, eq } from "drizzle-orm";
import { formTemplates, formData, formVersions } from "../../drizzle/schema/forms.js";
import { AppError } from "../../utils/appError.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { mergePdfFields } from "./pdf-merger.js";

/**
 * Self-healing (same pattern as document-folders.controller.ts's
 * ensureLibraryPool/ensureAdditionalSubfolders): platform.service.ts seeds
 * one default template per tenant at provisioning time from a fixed list,
 * but a form type added after a tenant was provisioned — or simply left off
 * that list by mistake (customer_requirements/inventory_item both were) —
 * had NO template row and 404'd on every Preview/Export PDF, forever, for
 * every tenant. That 404 also came back with no visible cause: exportFormPdf
 * uses `responseType: "arraybuffer"`, so the real JSON error body arrived as
 * raw bytes and extractErrorMessage silently fell back to its generic
 * caller-supplied text ("save it at least once first") regardless of what
 * actually failed — see useWorkflowAction.ts's own fix. Auto-provisioning
 * the default template here on first real use closes the gap for good,
 * without needing a one-off backfill script per tenant or a second list to
 * keep in sync with platform.service.ts's own.
 */
export async function loadTemplate(db: TenantDb, tenantId: number, formType: string) {
  const [template] = await db
    .select()
    .from(formTemplates)
    .where(and(eq(formTemplates.tenantId, tenantId), eq(formTemplates.formType, formType)))
    .orderBy(desc(formTemplates.id)); // prefer a tenant-uploaded custom template over the seeded default if both exist
  if (template) return template;

  const [created] = await db.insert(formTemplates).values({ tenantId, formType, pdfPath: `/templates/defaults/${formType}.pdf`, fieldMap: {}, isDefault: "true" }).returning();
  return created!;
}

/** Loads the current (highest-version) form_data row for an entity, or null if none exists yet. */
export async function loadData(db: TenantDb, tenantId: number, formType: string, entityId?: number) {
  const conditions = [eq(formData.tenantId, tenantId), eq(formData.formType, formType)];
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
export async function saveData(db: TenantDb, tenantId: number, input: SaveInput) {
  const existing = await loadData(db, tenantId, input.formType, input.entityId);

  if (existing) {
    const [updated] = await db
      .update(formData)
      .set({ data: input.data, updatedAt: new Date() })
      .where(and(eq(formData.id, existing.id), eq(formData.tenantId, tenantId)))
      .returning();
    return updated;
  }

  const [created] = await db
    .insert(formData)
    .values({
      tenantId,
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
export async function createVersion(db: TenantDb, tenantId: number, formId: number, userId?: number) {
  const [current] = await db.select().from(formData).where(and(eq(formData.id, formId), eq(formData.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Form");

  const nextVersion = current.version + 1;
  await db.insert(formVersions).values({ tenantId, formId, version: current.version, data: current.data, createdBy: userId });
  const [updated] = await db.update(formData).set({ version: nextVersion, updatedAt: new Date() }).where(eq(formData.id, formId)).returning();
  return updated;
}

export async function listVersions(db: TenantDb, tenantId: number, formId: number) {
  return db
    .select()
    .from(formVersions)
    .where(and(eq(formVersions.formId, formId), eq(formVersions.tenantId, tenantId)))
    .orderBy(desc(formVersions.version));
}

export async function exportPdf(db: TenantDb, tenantId: number, formType: string, entityId?: number) {
  const template = await loadTemplate(db, tenantId, formType);
  const current = await loadData(db, tenantId, formType, entityId);
  if (!current) throw AppError.notFound("Form data");

  const pdfBytes = await mergePdfFields(template, current.data);
  return pdfBytes;
}
