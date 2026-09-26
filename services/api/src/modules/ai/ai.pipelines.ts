import { callLlmDetailed, type LlmCallOptions, type LlmCallResult } from "./llm-gateway.js";
import { classifyOutput, type ClassifiedOutput } from "./ai.guardrails.js";
import * as schemas from "./ai.guardrails.js";
import {
  rootCausePrompt,
  capaPrompt,
  eightDPrompt,
  riskScorePrompt,
  auditPrepPrompt,
  documentSummaryPrompt,
  predictiveQualityPrompt,
  formSuggestPrompt,
  formAutofillPrompt,
  ncrTriagePrompt,
  supplierMessageDraftPrompt,
  warrantyTriagePrompt,
  reportSummaryPrompt,
  inspectionNotesPrompt,
  workflowAiNotePrompt,
} from "./prompts.js";

/**
 * Every pipeline now returns both the classified/guarded output AND the raw
 * LlmCallResult (real usage/model/isStub) — Phase 4 unification: previously
 * only the parsed JSON left this file, so ai.controller.ts had no usage/cost
 * to record and every one of these 9 endpoints bypassed the company BYOK
 * config, the monthly usage-limit check, and the audit trail entirely (see
 * ai.usage.ts's recordAiSuggestion, which every newer pipeline — Work Order
 * Planning, PR Justification, ERP Automation, Risk Register — already used).
 * ai.controller.ts now calls recordAiSuggestion with this same shape for
 * every endpoint, closing that gap.
 */
export interface PipelineRun {
  classified: ClassifiedOutput;
  result: LlmCallResult;
}

async function run(prompt: string, system: string, schema: Parameters<typeof classifyOutput>[2], options: LlmCallOptions): Promise<PipelineRun> {
  const result = await callLlmDetailed(prompt, { ...options, system });
  return { classified: classifyOutput(result.text, result.isStub, schema), result };
}

export const runRootCausePipeline = (ncrData: unknown, options: LlmCallOptions = {}) =>
  run(rootCausePrompt(ncrData), "You are AccuQual's root cause analysis engine.", schemas.rootCauseOutputSchema, options);

export const runCapaGeneratorPipeline = (rootCause: unknown, ncrData: unknown, options: LlmCallOptions = {}) =>
  run(capaPrompt(rootCause, ncrData), "You are AccuQual's CAPA generation engine.", schemas.capaOutputSchema, options);

export const runEightDGeneratorPipeline = (ncrData: unknown, capaData: unknown, options: LlmCallOptions = {}) =>
  run(eightDPrompt(ncrData, capaData), "You are AccuQual's 8D report drafting engine.", schemas.eightDOutputSchema, options);

export const runRiskScoringPipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(riskScorePrompt(input), "You are AccuQual's risk scoring engine.", schemas.riskScoreOutputSchema, options);

export const runAuditPrepPipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(auditPrepPrompt(input), "You are AccuQual's audit preparation assistant.", schemas.auditPrepOutputSchema, options);

export const runDocumentSummaryPipeline = (content: string, options: LlmCallOptions = {}) =>
  run(documentSummaryPrompt(content), "You are AccuQual's document summarization engine.", schemas.documentSummaryOutputSchema, options);

export const runPredictiveQualityPipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(predictiveQualityPrompt(input), "You are AccuQual's predictive quality engine.", schemas.predictiveQualityOutputSchema, options);

export const runFormSuggestPipeline = (formType: string, partialData: unknown, options: LlmCallOptions = {}) =>
  run(formSuggestPrompt(formType, partialData), "You are AccuQual's form-completion assistant.", schemas.formSuggestOutputSchema, options);

export const runFormAutofillPipeline = (formType: string, context: unknown, options: LlmCallOptions = {}) =>
  run(formAutofillPrompt(formType, context), "You are AccuQual's form-completion assistant.", schemas.formAutofillOutputSchema, options);

// Phase 4 new module-level integration points — prepared, stub-safe (no key
// = the same deterministic stub every other pipeline returns), never
// auto-applied to a real record; each caller shows the suggestion for a
// human to review and apply through that module's own normal write path.
export const runNcrTriagePipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(ncrTriagePrompt(input), "You are AccuQual's NCR triage assistant.", schemas.ncrTriageOutputSchema, options);

export const runSupplierMessageDraftPipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(supplierMessageDraftPrompt(input), "You are AccuQual's supplier relations assistant.", schemas.supplierMessageDraftOutputSchema, options);

export const runWarrantyTriagePipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(warrantyTriagePrompt(input), "You are AccuQual's warranty claims assistant.", schemas.warrantyTriageOutputSchema, options);

// Phase 6 — AI-assisted report summaries (quality trends, supplier risk
// changes, warranty patterns, production deviations), always a
// non-authoritative note over already-real, already-aggregated data.
export const runReportSummaryPipeline = (kind: string, input: unknown, options: LlmCallOptions = {}) =>
  run(reportSummaryPrompt(kind, input), "You are AccuQual's reporting analyst.", schemas.reportSummaryOutputSchema, options);

// Phase 8 — "AI-assisted inspection notes" (task 1's Phase 5 dependency).
export const runInspectionNotesPipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(inspectionNotesPrompt(input), "You are AccuQual's quality inspection assistant.", schemas.inspectionNotesOutputSchema, options);

// Phase 9 — Workflow Actions' generic "ai_suggestion" action kind.
export const runWorkflowAiNotePipeline = (input: unknown, options: LlmCallOptions = {}) =>
  run(workflowAiNotePrompt(input), "You are AccuQual's workflow assistant.", schemas.workflowAiNoteOutputSchema, options);
