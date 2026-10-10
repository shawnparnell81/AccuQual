import { eq, and } from "drizzle-orm";
import { formData } from "../../drizzle/schema/forms.js";
import type { Db } from "../../lib/requestDb.js";
import { answersWithTemplateStamp, readTemplateStamp, templateRevisionFor } from "../forms/templateRevision.js";
import { mergeStageIntoDocument } from "./ncr.document.js";

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
  dispositionNote?: string;
  verificationText?: string;
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

/**
 * The bare NCR columns and the official form (`layouts/ncr.ts`) do not share a table.
 * This copies the bare fields into the form so a filled NCR is not a blank document.
 *
 * Stage text is one source of truth with the document: containment, the
 * root-cause summary and 5-Why, disposition, corrective action, and
 * verification are written here, and a document save writes those same
 * fields back onto the NCR. Every call still only touches the fields in
 * `patch`. Closure signatures and the rest of the document stay put.
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
  const stagePatch = mergeStageIntoDocument(data, {
    ...(patch.containmentActionText !== undefined ? { containment: patch.containmentActionText } : {}),
    ...(patch.identifiedRootCauseSummary !== undefined ? { rootCause: patch.identifiedRootCauseSummary } : {}),
    ...(patch.correctiveActionText !== undefined ? { correctiveAction: patch.correctiveActionText } : {}),
    ...(patch.dispositionNote !== undefined ? { disposition: patch.dispositionNote } : {}),
    ...(patch.verificationText !== undefined ? { verification: patch.verificationText } : {}),
  });
  if (patch.containmentActionText !== undefined) data.containmentActions = stagePatch.containmentActions;
  if (patch.identifiedRootCauseSummary !== undefined) {
    data.identifiedRootCauseSummary = stagePatch.identifiedRootCauseSummary;
    data.fiveWhyAnalysis = stagePatch.fiveWhyAnalysis;
  }
  if (patch.correctiveActionText !== undefined) data.correctiveActions = stagePatch.correctiveActions;
  if (patch.verificationText !== undefined) data.effectivenessVerification = stagePatch.effectivenessVerification;
  if (patch.dispositionNote !== undefined && stagePatch.suspectMaterialDisposition !== undefined) {
    data.suspectMaterialDisposition = stagePatch.suspectMaterialDisposition;
  }
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
