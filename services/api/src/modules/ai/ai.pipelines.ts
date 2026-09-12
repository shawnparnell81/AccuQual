import { callLlm } from "./llm-gateway.js";
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
} from "./prompts.js";

/** Parses the LLM's JSON response, falling back to a raw-text wrapper if it isn't valid JSON. */
function parseJsonResponse(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    return { raw };
  }
}

export async function runRootCausePipeline(ncrData: unknown) {
  const raw = await callLlm(rootCausePrompt(ncrData), { system: "You are AccuQual's root cause analysis engine." });
  return parseJsonResponse(raw);
}

export async function runCapaGeneratorPipeline(rootCause: unknown, ncrData: unknown) {
  const raw = await callLlm(capaPrompt(rootCause, ncrData), { system: "You are AccuQual's CAPA generation engine." });
  return parseJsonResponse(raw);
}

export async function runEightDGeneratorPipeline(ncrData: unknown, capaData: unknown) {
  const raw = await callLlm(eightDPrompt(ncrData, capaData), { system: "You are AccuQual's 8D report drafting engine." });
  return parseJsonResponse(raw);
}

export async function runRiskScoringPipeline(input: unknown) {
  const raw = await callLlm(riskScorePrompt(input), { system: "You are AccuQual's risk scoring engine." });
  return parseJsonResponse(raw);
}

export async function runAuditPrepPipeline(input: unknown) {
  const raw = await callLlm(auditPrepPrompt(input), { system: "You are AccuQual's audit preparation assistant." });
  return parseJsonResponse(raw);
}

export async function runDocumentSummaryPipeline(content: string) {
  const raw = await callLlm(documentSummaryPrompt(content), { system: "You are AccuQual's document summarization engine." });
  return parseJsonResponse(raw);
}

export async function runPredictiveQualityPipeline(input: unknown) {
  const raw = await callLlm(predictiveQualityPrompt(input), { system: "You are AccuQual's predictive quality engine." });
  return parseJsonResponse(raw);
}

export async function runFormSuggestPipeline(formType: string, partialData: unknown) {
  const raw = await callLlm(formSuggestPrompt(formType, partialData), { system: "You are AccuQual's form-completion assistant." });
  return parseJsonResponse(raw);
}

export async function runFormAutofillPipeline(formType: string, context: unknown) {
  const raw = await callLlm(formAutofillPrompt(formType, context), { system: "You are AccuQual's form-completion assistant." });
  return parseJsonResponse(raw);
}
