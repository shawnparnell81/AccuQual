import { and, eq } from "drizzle-orm";
import { complaints, type Complaint } from "../../drizzle/schema/complaints.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { mergeFormData } from "../forms/formDataMerge.js";

export const COMPLAINT_FORM_TYPE = "complaint";

/** Record -> form: the complaint form's two fields (description, resolution) mirror the record. Empty values never blank what a user typed into the form. */
export async function syncComplaintRecordToForm(db: Db, c: Complaint, createdBy?: number): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (c.description) patch.description = c.description;
  if (c.resolution) patch.resolution = c.resolution;
  if (Object.keys(patch).length === 0) return;
  await mergeFormData(db, { formType: COMPLAINT_FORM_TYPE, entityType: "complaint", entityId: c.id, patch, createdBy });
}

/** Form -> record, after every save of the complaint form. Status never flows this way (guarded endpoints only); a closed complaint ignores late form edits. */
export async function syncComplaintFormToRecord(db: Db, id: number, data: Record<string, unknown>, performedBy?: number): Promise<void> {
  const [record] = await db.select().from(complaints).where(and(eq(complaints.id, id)));
  if (!record || record.status === "closed") return;

  const update: Partial<typeof complaints.$inferInsert> = {};
  if (typeof data.description === "string" && data.description.trim() && data.description !== record.description) update.description = data.description;
  if (typeof data.resolution === "string") {
    const next = data.resolution.trim() ? data.resolution : null;
    if (next !== record.resolution) update.resolution = next;
  }
  if (Object.keys(update).length === 0) return;

  await db.update(complaints).set({ ...update, updatedAt: new Date() }).where(eq(complaints.id, id));
  await recordAuditTrail(db, { entityType: "Complaint", entityId: id, action: "update", changes: { fieldsChanged: Object.keys(update), source: "form" }, performedBy });
}
