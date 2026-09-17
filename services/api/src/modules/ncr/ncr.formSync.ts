import { eq, and } from "drizzle-orm";
import { formData } from "../../drizzle/schema/forms.js";
import type { TenantDb } from "../../lib/tenantScope.js";

const FORM_TYPE = "ncr";
const ENTITY_TYPE = "ncr";

type Row = Record<string, unknown>;

export interface NcrFormSyncPatch {
  ncrNumber?: string;
  dateIssued?: string;
  documentStatus?: "Draft" | "Active" | "Closed";
  nonconformanceDescription?: string;
  ncrClassification?: "Minor" | "Major" | "Critical";
  identifiedRootCauseSummary?: string;
  containmentActionText?: string;
  correctiveActionText?: string;
  ncrClosureDate?: string;
  finalDispositionConfirmed?: "Yes" | "No";
}

/** ncr.severity ("low"|"medium"|"high"|"critical") has no exact 1:1 match in the form's 3-option checkbox — mapped, not dropped. */
export function mapSeverityToClassification(severity: string | null): NcrFormSyncPatch["ncrClassification"] | undefined {
  switch (severity) {
    case "low":
      return "Minor";
    case "medium":
    case "high":
      return "Major";
    case "critical":
      return "Critical";
    default:
      return undefined;
  }
}

export function ncrIsoDate(d: Date | string): string {
  return (typeof d === "string" ? new Date(d) : d).toISOString().slice(0, 10);
}

/** A fixedRowLabels table with one checkboxGroup column (documentStatus, ncrClassification) — see layouts/ncr.ts. Single-select in practice even though the renderer's data shape technically allows multiple. */
function setSingleCheckboxRow(existing: unknown, columnKey: string, value: string): Row[] {
  const rows = Array.isArray(existing) ? (existing as Row[]) : [{}];
  const row = { ...rows[0], [columnKey]: { [value]: true } };
  return [row, ...rows.slice(1)];
}

/** An addableRows table (containmentActions, correctiveActions) — only ever touches row 0's own column, so a user's own additional rows in the rich form are never overwritten. */
function setFirstRowField(existing: unknown, columnKey: string, value: string, minRows: number): Row[] {
  const rows = Array.isArray(existing) && existing.length > 0 ? [...(existing as Row[])] : Array.from({ length: minRows }, () => ({}));
  rows[0] = { ...rows[0], [columnKey]: value };
  return rows;
}

/**
 * Phase 2 NCR unified-data-model fix: the bare ncr row (title/description/
 * containment/rootCause/correctiveAction/status/severity) and the official
 * NCR document (form_data, ~50 fields across 9 fixed sections, "derived 1:1
 * from the user-provided PDF template" — see layouts/ncr.ts) used to be
 * completely disconnected — nothing ever wrote from one into the other, so
 * a fully-described NCR could sit next to a totally blank official document
 * (the buyer evaluation's exact "NCR duplicate-entry problem" finding,
 * confirmed live against NCR #8 before this fix).
 *
 * This is a deliberate ONE-WAY sync, bare -> form, not a merge into a
 * single table: the two field sets are almost entirely disjoint (~50 fields
 * across 9 fixed sections vs. 7 bare columns), and the bare fields drive
 * real status-gated workflow logic (ncr.service.ts's patchNcr) that
 * shouldn't be second-guessed by whatever a quality engineer typed
 * directly into the richer document. Every call here does a TARGETED
 * partial merge of `data` — it only ever touches the specific field(s)
 * passed in `patch`, never the RCA method, 5-Why table, closure
 * signatures, or any other section a user has filled in directly.
 */
export async function syncNcrFormData(db: TenantDb, tenantId: number, ncrId: number, patch: NcrFormSyncPatch, createdBy?: number): Promise<void> {
  const [existing] = await db
    .select()
    .from(formData)
    .where(and(eq(formData.tenantId, tenantId), eq(formData.formType, FORM_TYPE), eq(formData.entityType, ENTITY_TYPE), eq(formData.entityId, ncrId)));
  const data: Record<string, unknown> = { ...(existing?.data ?? {}) };

  // ncrNumber/dateIssued are set once, on creation, and never overwritten
  // afterward — they're document-control fields a quality engineer might
  // deliberately edit by hand later (e.g. a real revision-controlled NCR
  // number scheme), and re-stamping them on every sync would fight that.
  if (patch.ncrNumber !== undefined && data.ncrNumber === undefined) data.ncrNumber = patch.ncrNumber;
  if (patch.dateIssued !== undefined && data.dateIssued === undefined) data.dateIssued = patch.dateIssued;

  if (patch.documentStatus !== undefined) data.documentStatus = setSingleCheckboxRow(data.documentStatus, "status", patch.documentStatus);
  if (patch.nonconformanceDescription !== undefined) data.nonconformanceDescription = patch.nonconformanceDescription;
  if (patch.ncrClassification !== undefined) data.ncrClassification = setSingleCheckboxRow(data.ncrClassification, "classification", patch.ncrClassification);
  if (patch.identifiedRootCauseSummary !== undefined) data.identifiedRootCauseSummary = patch.identifiedRootCauseSummary;
  if (patch.containmentActionText !== undefined) data.containmentActions = setFirstRowField(data.containmentActions, "action", patch.containmentActionText, 3);
  if (patch.correctiveActionText !== undefined) data.correctiveActions = setFirstRowField(data.correctiveActions, "description", patch.correctiveActionText, 5);
  if (patch.ncrClosureDate !== undefined) data.ncrClosureDate = patch.ncrClosureDate;
  if (patch.finalDispositionConfirmed !== undefined) data.finalDispositionConfirmed = patch.finalDispositionConfirmed;

  if (existing) {
    await db.update(formData).set({ data, updatedAt: new Date() }).where(eq(formData.id, existing.id));
  } else {
    await db.insert(formData).values({ tenantId, formType: FORM_TYPE, entityType: ENTITY_TYPE, entityId: ncrId, data, createdBy });
  }
}
