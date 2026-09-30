import { and, desc, eq } from "drizzle-orm";
import { formData } from "../../drizzle/schema/forms.js";
import type { Db } from "../../lib/requestDb.js";
import { answersWithTemplateStamp, readTemplateStamp, templateRevisionFor } from "./templateRevision.js";

/**
 * Targeted merge into one record's form_data row — used to keep a record's
 * own columns and its fillable form in sync (see quality.formSync.ts,
 * complaints.formSync.ts). Same row lookup as forms.service.ts's loadData
 * (formType + entityId, highest id) so this writes to the exact row the UI
 * reads and autosaves, never a second one.
 *
 * `patch` always overwrites its keys; `defaults` only fills keys that are
 * still empty, so a value a user typed into the form by hand is never
 * clobbered by a one-time seed. Every other key in `data` is left alone.
 * A no-op merge (nothing would change) writes nothing.
 */
export async function mergeFormData(
  db: Db,
  opts: { formType: string; entityType: string; entityId: number; patch?: Record<string, unknown>; defaults?: Record<string, unknown>; createdBy?: number }
): Promise<void> {
  const [existing] = await db
    .select()
    .from(formData)
    .where(and(eq(formData.formType, opts.formType), eq(formData.entityId, opts.entityId)))
    .orderBy(desc(formData.id));

  const merged: Record<string, unknown> = { ...(existing?.data ?? {}) };
  for (const [key, value] of Object.entries(opts.defaults ?? {})) {
    const current = merged[key];
    if (current === undefined || current === null || current === "") merged[key] = value;
  }
  Object.assign(merged, opts.patch ?? {});
  const data = answersWithTemplateStamp(`form:${opts.formType}`, existing?.data, merged, !existing);

  if (existing) {
    if (JSON.stringify(existing.data ?? {}) === JSON.stringify(data)) return;
    await db.update(formData).set({ data, updatedAt: new Date() }).where(eq(formData.id, existing.id));
  } else {
    const stamp = readTemplateStamp(data) ?? templateRevisionFor(`form:${opts.formType}`);
    await db.insert(formData).values({ formType: opts.formType, entityType: opts.entityType, entityId: opts.entityId, data, version: stamp.version, createdBy: opts.createdBy });
  }
}
