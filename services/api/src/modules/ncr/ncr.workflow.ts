import definition from "./ncr.workflow.json" with { type: "json" };

/**
 * NCR workflow definition. The JSON file is the schema: six steps, in order,
 * plus the transitions and the map from the previous status words.
 * A record's `workflow` object is that definition applied to one NCR:
 * currentStep, the transitions allowed from here, and the steps already reached.
 */

export interface NcrWorkflowStep {
  key: string;
  name: string;
}

export interface NcrWorkflowDefinition {
  steps: NcrWorkflowStep[];
  currentStep: string;
  allowedTransitions: Record<string, string[]>;
  history: { step: string; at: string | null }[];
  legacyMap: Record<string, string>;
}

export const NCR_WORKFLOW = definition.workflow as NcrWorkflowDefinition;

const STEP_NAME = new Map(NCR_WORKFLOW.steps.map((step) => [step.key, step.name]));
const STEP_INDEX = new Map(NCR_WORKFLOW.steps.map((step, index) => [step.key, index]));

export const NCR_STEP_KEYS = NCR_WORKFLOW.steps.map((step) => step.key);
export const NCR_STATUS_INPUTS = [...NCR_STEP_KEYS, ...Object.keys(NCR_WORKFLOW.legacyMap)] as [string, ...string[]];

/** Every non-terminal step, plus the old words, so open-work queries still find rows the migration has not rewritten yet. */
export const OPEN_NCR_STATUSES = [
  ...NCR_STEP_KEYS.filter((key) => key !== "closed"),
  ...Object.keys(NCR_WORKFLOW.legacyMap),
];

export function canonicalNcrStep(status: string | null | undefined): string {
  if (!status) return NCR_WORKFLOW.steps[0]!.key;
  return NCR_WORKFLOW.legacyMap[status] ?? status;
}

export function ncrStepLabel(status: string | null | undefined): string {
  const key = canonicalNcrStep(status);
  return STEP_NAME.get(key) ?? status ?? "NCR Created";
}

export function ncrStepIndex(status: string | null | undefined): number {
  const index = STEP_INDEX.get(canonicalNcrStep(status));
  return index ?? 0;
}

export function allowedTransitionKeys(status: string | null | undefined): string[] {
  return NCR_WORKFLOW.allowedTransitions[canonicalNcrStep(status)] ?? [];
}

/** Stored values that mean the same step, so a filter for either the old or the new word hits both. */
export function ncrStatusAliases(status: string): string[] {
  const key = canonicalNcrStep(status);
  const legacy = Object.entries(NCR_WORKFLOW.legacyMap)
    .filter(([, mapped]) => mapped === key)
    .map(([old]) => old);
  return [...new Set([key, status, ...legacy])];
}

export interface NcrWorkflowView {
  currentStep: string;
  allowedTransitions: string[];
  history: { step: string; at: string | null }[];
}

function iso(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "string") return value;
  return null;
}

/** Steps reached so far, in order. The current step is last. Future steps are not history yet. */
export function ncrWorkflowView(row: {
  status: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
  closedAt?: unknown;
}): NcrWorkflowView {
  const key = canonicalNcrStep(row.status);
  const index = STEP_INDEX.get(key);
  if (index === undefined) {
    const label = row.status ?? "NCR Created";
    return { currentStep: label, allowedTransitions: [], history: [{ step: label, at: iso(row.updatedAt) }] };
  }
  const current = NCR_WORKFLOW.steps[index]!;
  return {
    currentStep: current.name,
    allowedTransitions: allowedTransitionKeys(key).map((next) => STEP_NAME.get(next) ?? next),
    history: NCR_WORKFLOW.steps.slice(0, index + 1).map((step, i) => ({
      step: step.name,
      at: i === 0 ? iso(row.createdAt) : i === index ? iso(key === "closed" ? (row.closedAt ?? row.updatedAt) : row.updatedAt) : null,
    })),
  };
}

function isNcrRow(value: unknown): value is { status: string; createdAt?: unknown; updatedAt?: unknown; closedAt?: unknown } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return typeof row.status === "string" && typeof row.title === "string" && "containment" in row;
}

/** Read path: old stored statuses become the new step key, and the workflow section is attached. */
export function decorateNcrBody(body: unknown): unknown {
  if (Array.isArray(body)) return body.map((item) => decorateNcrBody(item));
  if (!isNcrRow(body)) return body;
  const status = canonicalNcrStep(body.status);
  return { ...body, status, workflow: ncrWorkflowView({ ...body, status }) };
}
