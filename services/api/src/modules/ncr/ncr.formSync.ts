import { eq, and } from "drizzle-orm";
import { formData } from "../../drizzle/schema/forms.js";
import type { Db } from "../../lib/requestDb.js";
import { answersWithTemplateStamp, readTemplateStamp, templateRevisionFor } from "../forms/templateRevision.js";

const FORM_TYPE = "ncr";
const ENTITY_TYPE = "ncr";

type Row = Record<string, unknown>;

export interface NcrFormSyncPatch {
  ncrNumber?: string;
  /** When the record's own number changed, write it onto the form even if a number was already there. */
  forceNcrNumber?: boolean;
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
  if (typeof d === "string") {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(d.trim());
    if (match) return match[1]!;
  }
  const date = d instanceof Date ? d : new Date(d);
  return date.toISOString().slice(0, 10);
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
 * The bare NCR columns and the official form (`layouts/ncr.ts`) do not share a table.
 * This copies the bare fields into the form so a filled NCR is not a blank document.
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
export async function syncNcrFormData(db: Db, ncrId: number, patch: NcrFormSyncPatch, createdBy?: number): Promise<void> {
  const [existing] = await db
    .select()
    .from(formData)
    .where(and(eq(formData.formType, FORM_TYPE), eq(formData.entityType, ENTITY_TYPE), eq(formData.entityId, ncrId)));
  const data: Record<string, unknown> = { ...(existing?.data ?? {}) };

  // ncrNumber/dateIssued are set once, on creation, and never overwritten
  // afterward — they're document-control fields a quality engineer might
  // deliberately edit by hand later (e.g. a real revision-controlled NCR
  // number scheme), and re-stamping them on every sync would fight that.
  if (patch.ncrNumber !== undefined && (data.ncrNumber === undefined || patch.forceNcrNumber)) data.ncrNumber = patch.ncrNumber;
  if (patch.dateIssued !== undefined && data.dateIssued === undefined) data.dateIssued = patch.dateIssued;

  if (patch.documentStatus !== undefined) data.documentStatus = setSingleCheckboxRow(data.documentStatus, "status", patch.documentStatus);
  if (patch.nonconformanceDescription !== undefined) data.nonconformanceDescription = patch.nonconformanceDescription;
  if (patch.ncrClassification !== undefined) data.ncrClassification = setSingleCheckboxRow(data.ncrClassification, "classification", patch.ncrClassification);
  if (patch.identifiedRootCauseSummary !== undefined) data.identifiedRootCauseSummary = patch.identifiedRootCauseSummary;
  if (patch.containmentActionText !== undefined) data.containmentActions = setFirstRowField(data.containmentActions, "action", patch.containmentActionText, 3);
  if (patch.correctiveActionText !== undefined) data.correctiveActions = setFirstRowField(data.correctiveActions, "description", patch.correctiveActionText, 5);
  if (patch.ncrClosureDate !== undefined) data.ncrClosureDate = patch.ncrClosureDate;
  if (patch.finalDispositionConfirmed !== undefined) data.finalDispositionConfirmed = patch.finalDispositionConfirmed;

  const stamped = answersWithTemplateStamp(`form:${FORM_TYPE}`, existing?.data, data, !existing);
  if (existing) {
    await db.update(formData).set({ data: stamped, updatedAt: new Date() }).where(eq(formData.id, existing.id));
  } else {
    const stamp = readTemplateStamp(stamped) ?? templateRevisionFor(`form:${FORM_TYPE}`);
    await db.insert(formData).values({ formType: FORM_TYPE, entityType: ENTITY_TYPE, entityId: ncrId, data: stamped, version: stamp.version, createdBy });
  }
}
