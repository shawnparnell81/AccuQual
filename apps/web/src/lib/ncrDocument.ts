import { getFormLayout } from "../components/forms/layouts";
import { choiceOf, layoutSignatureBlocks, NOT_REQUIRED_LABEL } from "../components/forms/signatureRequired";

export interface NcrStageText {
  containment?: string;
  rootCause?: string;
  disposition?: string;
  correctiveAction?: string;
  verification?: string;
}

const DISPOSITION_OPTIONS = ["Use As-Is", "Rework", "Repair", "Scrap", "Return to Supplier", "Sort"] as const;
const STAGE_KEYS = ["containmentActions", "fiveWhyAnalysis", "identifiedRootCauseSummary", "correctiveActions", "effectivenessVerification", "suspectMaterialDisposition"] as const;

type Row = Record<string, unknown>;

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function setFirst(existing: unknown, key: string, value: string, minRows: number): Row[] {
  const rows = rowsOf(existing).map((row) => ({ ...row }));
  while (rows.length < minRows) rows.push({});
  rows[0] = { ...(rows[0] ?? {}), [key]: value };
  return rows;
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function matchDispositionOption(note: string): (typeof DISPOSITION_OPTIONS)[number] | null {
  const wanted = compact(note);
  if (!wanted) return null;
  const ordered = [...DISPOSITION_OPTIONS].sort((a, b) => compact(b).length - compact(a).length);
  return ordered.find((option) => wanted.includes(compact(option))) ?? null;
}

function whyRows(existing: unknown, rootCause: string): Row[] {
  const lines = rootCause.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const rows = rowsOf(existing).map((row) => ({ ...row }));
  while (rows.length < 5) rows.push({});
  if (lines.length >= 2) {
    lines.slice(0, 5).forEach((answer, index) => {
      rows[index] = { ...(rows[index] ?? {}), answer };
    });
  } else {
    rows[4] = { ...(rows[4] ?? {}), answer: rootCause.trim() };
  }
  return rows.slice(0, 5);
}

/** Same mapping the API writes, so the on-screen NCR updates before the save returns. */
export function mergeStageIntoDocument(data: Record<string, unknown>, stage: NcrStageText): Record<string, unknown> {
  const next: Record<string, unknown> = { ...data };
  if (stage.containment !== undefined) next.containmentActions = setFirst(data.containmentActions, "action", stage.containment, 3);
  if (stage.rootCause !== undefined) {
    next.identifiedRootCauseSummary = stage.rootCause;
    next.fiveWhyAnalysis = whyRows(data.fiveWhyAnalysis, stage.rootCause);
  }
  if (stage.correctiveAction !== undefined) next.correctiveActions = setFirst(data.correctiveActions, "description", stage.correctiveAction, 5);
  if (stage.verification !== undefined) next.effectivenessVerification = setFirst(data.effectivenessVerification, "resultObservations", stage.verification, 3);
  if (stage.disposition !== undefined) {
    const option = matchDispositionOption(stage.disposition);
    if (option) {
      const selected: Record<string, boolean> = { [option]: true };
      if (option === "Use As-Is") {
        const lower = stage.disposition.toLowerCase();
        if (lower.includes("no concession")) selected["no concession"] = true;
        else if (lower.includes("concession")) selected["with concession"] = true;
      }
      const rows = rowsOf(data.suspectMaterialDisposition).map((row) => ({ ...row }));
      next.suspectMaterialDisposition = [{ ...(rows[0] ?? {}), disposition: selected }, ...rows.slice(1)];
    }
  }
  return next;
}

export function stagePreviewPatch(data: Record<string, unknown>, stage: NcrStageText): Record<string, unknown> {
  const merged = mergeStageIntoDocument(data, stage);
  const patch: Record<string, unknown> = {};
  for (const key of STAGE_KEYS) {
    if (merged[key] !== data[key]) patch[key] = merged[key];
  }
  return patch;
}

function valueAt(data: Record<string, unknown>, path: string): string {
  let current: unknown = data;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current[Number(part)];
    else if (current && typeof current === "object") current = (current as Record<string, unknown>)[part];
    else return "";
  }
  return typeof current === "string" ? current.trim() : "";
}

export function closureRoleLabel(label: string): string {
  return label.replace(/\s+signature$/i, "").trim();
}

/** Required closure roles with no stamp. A role marked Not required is skipped. */
export function missingClosureSignatures(data: Record<string, unknown> | null | undefined): { path: string; label: string }[] {
  const layout = getFormLayout("ncr");
  if (!layout) return [];
  const source = data ?? {};
  const blocks = layoutSignatureBlocks(layout).filter((block) => block.path.startsWith("closureApprovals."));
  const missing: { path: string; label: string }[] = [];
  for (const block of blocks) {
    if (choiceOf(source, block.path) === "no") continue;
    const stamp = valueAt(source, block.path);
    if (!stamp || stamp === NOT_REQUIRED_LABEL) missing.push({ path: block.path, label: closureRoleLabel(block.label) });
  }
  return missing;
}

export const NCR_CLOSURE_CERTIFY = "I certify that this nonconformance record is accurate and that I approve closure.";
