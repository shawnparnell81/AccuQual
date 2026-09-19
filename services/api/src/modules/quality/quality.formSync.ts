import { and, eq } from "drizzle-orm";
import { discrepancyInvestigations, type DiscrepancyInvestigation } from "../../drizzle/schema/quality.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { mergeFormData } from "../forms/formDataMerge.js";

export const DI_FORM_TYPE = "discrepancy_inspection";
const ENTITY_TYPE = "discrepancy_investigation";

/** record.disposition (enum) <-> the form's checkbox labels (layouts/discrepancyInspection.ts) */
const DISPOSITION_LABELS: Record<string, string> = {
  "use-as-is": "Use As-Is",
  rework: "Rework",
  repair: "Repair",
  scrap: "Scrap",
  "return-to-supplier": "Return to Supplier",
  sort: "Sort",
};
const SEVERITY_LABELS: Record<string, string> = { minor: "Minor", major: "Major", critical: "Critical" };
const STATUS_LABELS: Record<string, string> = { open: "Open", investigating: "Investigating", disposed: "Disposed", closed: "Closed" };

function reverseLookup(labels: Record<string, string>, label: unknown): string | undefined {
  return Object.entries(labels).find(([, l]) => l === label)?.[0];
}

/**
 * Record -> form. Status and disposition always mirror the record (they're
 * workflow-driven: status only moves through the guarded endpoints, so the
 * form can only ever display it). Title/severity/description are only
 * written when the record has a value, so an empty record never blanks
 * something a user already typed into the form. The source reference is a
 * one-time seed for auto-created investigations.
 */
export async function syncDiRecordToForm(db: TenantDb, tenantId: number, di: DiscrepancyInvestigation, createdBy?: number): Promise<void> {
  const patch: Record<string, unknown> = {
    status: STATUS_LABELS[di.status] ?? di.status,
    disposition: [{ value: di.disposition && DISPOSITION_LABELS[di.disposition] ? { [DISPOSITION_LABELS[di.disposition]!]: true } : {} }],
  };
  if (di.title) patch.title = di.title;
  if (di.severity && SEVERITY_LABELS[di.severity]) patch.severity = SEVERITY_LABELS[di.severity];
  if (di.description) patch.description = di.description;

  const defaults: Record<string, unknown> = {};
  if (di.sourceAuditId) {
    defaults.sourceReference = di.sourceAuditItemId ? `Audit #${di.sourceAuditId} — Finding #${di.sourceAuditItemId}` : `Audit #${di.sourceAuditId}`;
  }

  await mergeFormData(db, tenantId, { formType: DI_FORM_TYPE, entityType: ENTITY_TYPE, entityId: di.id, patch, defaults, createdBy });
}

/**
 * Form -> record, run after every save of the DI form. Only the descriptive
 * fields flow back (title, severity, description, disposition); status never
 * does — it moves only through the guarded investigate/dispose/close
 * endpoints, so editing the form's Status box can't skip the workflow. A
 * closed investigation is immutable, so a late form edit is ignored rather
 * than rewriting a closed record.
 */
export async function syncDiFormToRecord(db: TenantDb, tenantId: number, diId: number, data: Record<string, unknown>, performedBy?: number): Promise<void> {
  const [record] = await db
    .select()
    .from(discrepancyInvestigations)
    .where(and(eq(discrepancyInvestigations.id, diId), eq(discrepancyInvestigations.tenantId, tenantId)));
  if (!record || record.status === "closed") return;

  const update: Partial<typeof discrepancyInvestigations.$inferInsert> = {};

  if (typeof data.title === "string" && data.title.trim() && data.title.trim() !== record.title) update.title = data.title.trim();

  const severity = reverseLookup(SEVERITY_LABELS, data.severity);
  if (severity && severity !== record.severity) update.severity = severity;

  if (typeof data.description === "string") {
    const next = data.description.trim() ? data.description : null;
    if (next !== record.description) update.description = next;
  }

  const dispositionRows = Array.isArray(data.disposition) ? (data.disposition as Array<Record<string, unknown>>) : [];
  const checked = Object.entries((dispositionRows[0]?.value as Record<string, boolean> | undefined) ?? {})
    .filter(([, on]) => on)
    .map(([label]) => reverseLookup(DISPOSITION_LABELS, label))
    .filter((v): v is string => Boolean(v));
  if (checked.length === 1 && checked[0] !== record.disposition) {
    update.disposition = checked[0];
  } else if (checked.length === 0 && record.disposition && record.status !== "disposed") {
    // Unticking clears it — but not once the investigation has been disposed,
    // where the disposition is what that status means.
    update.disposition = null;
  }

  if (Object.keys(update).length === 0) return;
  await db.update(discrepancyInvestigations).set({ ...update, updatedAt: new Date() }).where(eq(discrepancyInvestigations.id, diId));
  await recordAuditTrail(db, {
    tenantId,
    entityType: "Discrepancy investigation",
    entityId: diId,
    action: "update",
    changes: { fieldsChanged: Object.keys(update), source: "form" },
    performedBy,
  });
}
