import { NOT_REQUIRED_LABEL, signatureBlocksFor, signatureRequired, type SignatureBlock } from "../signatures/signatureRequired.js";
import { ncrStepIndex } from "./ncr.workflow.js";

/** Text the workflow stages and the printed NCR document share. */
export interface NcrStageText {
  containment?: string;
  rootCause?: string;
  disposition?: string;
  correctiveAction?: string;
  verification?: string;
}

const DISPOSITION_OPTIONS = ["Use As-Is", "Rework", "Repair", "Scrap", "Return to Supplier", "Sort"] as const;

type Row = Record<string, unknown>;

function rowsOf(value: unknown): Row[] {
  return Array.isArray(value) ? (value as Row[]) : [];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

export function matchDispositionOption(note: string): (typeof DISPOSITION_OPTIONS)[number] | null {
  const wanted = compact(note);
  if (!wanted) return null;
  const ordered = [...DISPOSITION_OPTIONS].sort((a, b) => compact(b).length - compact(a).length);
  return ordered.find((option) => wanted.includes(compact(option))) ?? null;
}

function dispositionSelection(note: string): Record<string, boolean> | null {
  const option = matchDispositionOption(note);
  if (!option) return null;
  const selected: Record<string, boolean> = { [option]: true };
  if (option === "Use As-Is") {
    const lower = note.toLowerCase();
    if (lower.includes("no concession")) selected["no concession"] = true;
    else if (lower.includes("concession")) selected["with concession"] = true;
  }
  return selected;
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

/** Copies stage text onto the official NCR document. Other sections stay as they are. */
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
    const selected = dispositionSelection(stage.disposition);
    if (selected) {
      const rows = rowsOf(data.suspectMaterialDisposition).map((row) => ({ ...row }));
      const first = { ...(rows[0] ?? {}), disposition: selected };
      next.suspectMaterialDisposition = [first, ...rows.slice(1)];
    }
  }
  return next;
}

function checkedDisposition(data: Record<string, unknown>): string {
  const selected = rowsOf(data.suspectMaterialDisposition)[0]?.disposition;
  if (!selected || typeof selected !== "object" || Array.isArray(selected)) return "";
  const flags = selected as Record<string, boolean>;
  return DISPOSITION_OPTIONS.filter((option) => flags[option]).join(", ");
}

function whyRoot(data: Record<string, unknown>): string {
  const summary = textOf(data.identifiedRootCauseSummary);
  if (summary) return summary;
  const rows = rowsOf(data.fiveWhyAnalysis);
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const answer = textOf(rows[index]?.answer);
    if (answer) return answer;
  }
  return "";
}

/** Document fields that should be written back onto the NCR. Empty document fields do not clear the workflow. */
export function readStageFromDocument(data: Record<string, unknown>): NcrStageText {
  const stage: NcrStageText = {};
  const containment = textOf(rowsOf(data.containmentActions)[0]?.action);
  const rootCause = whyRoot(data);
  const correctiveAction = textOf(rowsOf(data.correctiveActions)[0]?.description);
  const verification = textOf(rowsOf(data.effectivenessVerification)[0]?.resultObservations);
  const disposition = checkedDisposition(data);
  if (containment) stage.containment = containment;
  if (rootCause) stage.rootCause = rootCause;
  if (correctiveAction) stage.correctiveAction = correctiveAction;
  if (verification) stage.verification = verification;
  if (disposition) stage.disposition = disposition;
  return stage;
}

export interface NcrStageColumns {
  containment: string | null;
  rootCause: string | null;
  correctiveAction: string | null;
  processData?: Record<string, unknown> | null;
}

function sameText(left: string | null | undefined, right: string): boolean {
  return (left ?? "").trim() === right;
}

/** Patch for the NCR row when the document is the side that changed. Status is never part of it. */
export function stageColumnPatch(current: NcrStageColumns, document: Record<string, unknown>): Partial<NcrStageColumns> | null {
  const stage = readStageFromDocument(document);
  const patch: Partial<NcrStageColumns> = {};
  if (stage.containment && !sameText(current.containment, stage.containment)) patch.containment = stage.containment;
  if (stage.rootCause && !sameText(current.rootCause, stage.rootCause)) patch.rootCause = stage.rootCause;
  if (stage.correctiveAction && !sameText(current.correctiveAction, stage.correctiveAction)) patch.correctiveAction = stage.correctiveAction;
  const process = current.processData && typeof current.processData === "object" ? { ...current.processData } : {};
  let processChanged = false;
  if (stage.verification && !sameText(typeof process.verification === "string" ? process.verification : "", stage.verification)) {
    process.verification = stage.verification;
    processChanged = true;
  }
  if (stage.disposition) {
    const currentNote = typeof process.dispositionNote === "string" ? process.dispositionNote.trim() : "";
    const longer = currentNote.length > stage.disposition.length && compact(currentNote).includes(compact(stage.disposition));
    if (!longer && currentNote !== stage.disposition) {
      process.dispositionNote = stage.disposition;
      processChanged = true;
    }
  }
  if (processChanged) patch.processData = process;
  return Object.keys(patch).length > 0 ? patch : null;
}

function valueAt(data: Record<string, unknown>, path: string): string {
  let current: unknown = data;
  for (const part of path.split(".")) {
    if (Array.isArray(current)) current = current[Number(part)];
    else if (current && typeof current === "object") current = (current as Record<string, unknown>)[part];
    else return "";
  }
  return textOf(current);
}

export function closureSignatureBlocks(): SignatureBlock[] {
  return signatureBlocksFor("form:ncr").filter((block) => block.path.startsWith("closureApprovals."));
}

export function closureRoleLabel(label: string): string {
  return label.replace(/\s+signature$/i, "").trim();
}

/** Roles still marked Required that have no PIN stamp. Required Yes/No lives on the document, not in this list. */
export function missingClosureSignatures(data: Record<string, unknown> | null | undefined): { path: string; label: string }[] {
  const source = data ?? {};
  const blocks = closureSignatureBlocks();
  const missing: { path: string; label: string }[] = [];
  for (const block of blocks) {
    if (!signatureRequired(source, block.path, blocks)) continue;
    const stamp = valueAt(source, block.path);
    if (!stamp || stamp === NOT_REQUIRED_LABEL) missing.push({ path: block.path, label: closureRoleLabel(block.label) });
  }
  return missing;
}

/** Quarantine complete moves the NCR to Disposition when it has not reached that step yet. */
export function dispositionAdvances(status: string | null | undefined, released: boolean): boolean {
  if (!released) return false;
  return ncrStepIndex(status) < ncrStepIndex("disposition");
}
