import { z } from "zod";
import { STUB_SIGNATURE } from "./llm-gateway.js";

/**
 * Phase 4 AI guardrails — the global "prevent a stub or malformed AI
 * response from persisting as if it were real" layer every pipeline now
 * goes through, in one place instead of each module re-inventing its own
 * check (Phase 0 only closed this for CAPA's rootCause field via a
 * hand-copied Zod `.refine`; every other pipeline had nothing).
 */

/** True whenever any string value anywhere in a parsed object is (or contains) the exact stub signature — catches it whether the whole payload is the stub or just one field got contaminated by a prior stub value being fed back in as context. */
export function containsStubSignature(value: unknown): boolean {
  if (typeof value === "string") return value.includes(STUB_SIGNATURE);
  if (Array.isArray(value)) return value.some(containsStubSignature);
  if (value && typeof value === "object") return Object.values(value).some(containsStubSignature);
  return false;
}

/**
 * The one Zod `.refine` predicate every free-text field fed by
 * AiFieldAssistant's "Insert" action should use — a persistence-boundary
 * check that holds regardless of which client calls the API, same as
 * capa.validation.ts's original hand-copied version (Phase 0). Exported
 * here so every other real onInsert site (NCR's containment/root-cause/
 * corrective-action ActionForms, Training's course description) can share
 * the exact same check instead of re-deriving it.
 */
export const rejectAiStubText = (value: string) => !containsStubSignature(value);
export const AI_STUB_REJECT_MESSAGE = "This looks like an unconfigured-AI placeholder response, not real content — it wasn't saved.";

export type AiOutputStatus = "ok" | "stub" | "malformed" | "error";

export interface ClassifiedOutput {
  status: AiOutputStatus;
  /** The schema-validated data on "ok", the best-effort raw parse otherwise — callers must check `status` before treating this as trustworthy. */
  data: Record<string, unknown>;
  errorMessage: string | null;
}

/**
 * A real model call (confirmed live via the prompt-injection hardening's
 * manual sanity check — every existing automated test only ever exercised
 * the deterministic stub path below, which never does this) can still wrap
 * an otherwise-perfect "strict JSON" response in a ```json ... ``` markdown
 * fence despite being told not to. Stripped before JSON.parse rather than
 * tightening the prompt wording further, since a prompt instruction is
 * best-effort and this is a one-line, zero-risk parse-time fix for it.
 */
function stripCodeFence(text: string): string {
  const match = text.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/i);
  return match?.[1] ?? text;
}

/**
 * Runs a pipeline's raw LLM text through JSON.parse + this pipeline's own
 * promised-shape schema (see the `*OutputSchema`s below, mirroring
 * prompts.ts's own "Respond as strict JSON: {...}" contract for each
 * pipeline). Never throws — a malformed response is data to report, not an
 * exception to crash the request on; the caller decides what a non-"ok"
 * status means for its own UI (show a "couldn't parse a clean suggestion"
 * message rather than silently rendering `undefined` fields).
 */
export function classifyOutput(rawText: string, isStub: boolean, schema: z.ZodType): ClassifiedOutput {
  if (isStub) return { status: "stub", data: { note: STUB_SIGNATURE, promptPreview: rawText.slice(0, 200) }, errorMessage: null };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    return { status: "malformed", data: { raw: rawText }, errorMessage: "The AI response was not valid JSON." };
  }

  if (containsStubSignature(parsed)) {
    return { status: "malformed", data: { raw: rawText }, errorMessage: "The AI response echoed a stub placeholder instead of real content." };
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    return { status: "malformed", data: parsed as Record<string, unknown>, errorMessage: `The AI response didn't match the expected shape: ${result.error.issues.map((i) => i.path.join(".") || "(root)").join(", ")}` };
  }
  return { status: "ok", data: result.data as Record<string, unknown>, errorMessage: null };
}

// One schema per pipeline, matching prompts.ts's own "Respond as strict JSON" contract exactly.
export const rootCauseOutputSchema = z.object({
  rootCause: z.string(),
  confidence: z.number(),
  reasoning: z.string(),
  suggestedCorrectiveActions: z.array(z.string()),
});

export const capaOutputSchema = z.object({
  actionPlan: z.string(),
  preventiveAction: z.string(),
  verification: z.string(),
  estimatedClosureDays: z.number(),
});

export const eightDOutputSchema = z.object({
  d1_team: z.string(),
  d2_problem: z.string(),
  d3_containment: z.string(),
  d4_rootCause: z.string(),
  d5_correctiveAction: z.string(),
  d6_implementation: z.string(),
  d7_prevention: z.string(),
  d8_closure: z.string(),
});

export const riskScoreOutputSchema = z.object({
  score: z.number(),
  riskFactors: z.array(z.string()),
  recommendedMitigations: z.array(z.string()),
});

export const auditPrepOutputSchema = z.object({
  focusAreas: z.array(z.string()),
  openRisks: z.array(z.string()),
  suggestedEvidence: z.array(z.string()),
});

export const documentSummaryOutputSchema = z.object({ summary: z.array(z.string()) });

export const formSuggestOutputSchema = z.object({ suggestions: z.record(z.string(), z.string()) });

export const formAutofillOutputSchema = z.object({ data: z.record(z.string(), z.string()) });

export const predictiveQualityOutputSchema = z.object({
  forecast: z.string(),
  driftRisk: z.enum(["low", "medium", "high"]),
  recommendedActions: z.array(z.string()),
});

export const ncrTriageOutputSchema = z.object({
  suggestedSeverity: z.enum(["low", "medium", "high", "critical"]),
  suggestedDepartment: z.string(),
  rationale: z.string(),
  similarPastNcrs: z.array(z.string()),
});

export const supplierMessageDraftOutputSchema = z.object({
  subject: z.string(),
  body: z.string(),
  tone: z.enum(["informational", "corrective_action_request", "escalation"]),
});

export const reportSummaryOutputSchema = z.object({
  summary: z.string(),
  watchItems: z.array(z.string()),
  trend: z.enum(["improving", "worsening", "stable", "insufficient_data"]),
});

export const warrantyTriageOutputSchema = z.object({
  suggestedDisposition: z.enum(["approve", "deny", "needs_inspection"]),
  estimatedCost: z.number().nullable(),
  rationale: z.string(),
});

/** Phase 8 — "AI-assisted inspection notes." confidence mirrors every other structured-suggestion pipeline's own 0-1 field (see AiStructuredSuggestion.tsx's shared confidence-bar rendering). */
export const inspectionNotesOutputSchema = z.object({
  summary: z.string(),
  suggestedDefectCategory: z.string().nullable(),
  confidence: z.number(),
});

/** Phase 9 — Workflow Actions' generic "ai_suggestion" action kind (see prompts.ts's workflowAiNotePrompt). */
export const workflowAiNoteOutputSchema = z.object({
  note: z.string(),
  suggestedNextStep: z.string(),
  confidence: z.number(),
});
