import { and, eq, gte, sql } from "drizzle-orm";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { company } from "../../drizzle/schema/company.js";
import { aiSuggestions } from "../../drizzle/schema/ai.js";
import { decryptSecret } from "../company/crypto.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { estimateCost } from "./pricing.js";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/appError.js";
import type { Db } from "../../lib/requestDb.js";
import type { LlmCallOptions, LlmCallResult } from "./llm-gateway.js";
import type { AiOutputStatus } from "./ai.guardrails.js";
import type { PipelineRun } from "./ai.pipelines.js";

/**
 * Phase 4 AI audit trail hooks: the one human-readable label the audit
 * trail (and any UI reading it back) shows for what actually happened on
 * this AI call — the literal 4 states the AI Enablement phase asked for,
 * plus "AI-error" for the one real failure case those 4 didn't name (a
 * provider call that threw after retries, not a bad response).
 *
 * `okVerb` is a free string (not a narrow union) as of Phase 5 — the AI
 * Feature Rollout phase specifies an exact literal phrase per module
 * ("AI-assisted triage", "AI-drafted CAPA content", "AI-drafted supplier
 * communication", "AI-assisted warranty triage", "AI-generated audit
 * summary", "AI-suggested ERP actions", "AI-assisted risk score") — each
 * call site below passes its own module's exact required phrase rather
 * than one of a handful of generic verbs.
 */
export function describeAiState(status: AiOutputStatus, okVerb = "AI-suggested"): string {
  switch (status) {
    case "stub":
      return "AI-disabled (no key)";
    case "malformed":
      return "AI-error (malformed response)";
    case "error":
      return "AI-error";
    case "ok":
    default:
      return okVerb;
  }
}

/**
 * BYOK monthly limit enforcement, shared by every AI endpoint that spends
 * tokens (originally lived only inside ai.assistant.ts's assistantHandler;
 * extracted here once the AI Work Order Planning / PR Justification /
 * ERP Automation pipelines needed the exact same check — see the AI
 * modules review). Checked before every real call, not against a stored
 * counter: a single cumulative field can't implement "monthly" without
 * something resetting it, and this app has no background jobs to do that
 * reset, so this instead sums this company's own real audit_trail rows
 * carrying a `tokens` field from the 1st of the current calendar month
 * onward. Deliberately NOT filtered to one entityType — companies.aiMonthlyLimit
 * is documented as an overall BYOK usage cap, not one scoped to a single
 * feature, so every AI pipeline's spend counts against the same limit.
 * Returns null when under limit (or no limit set), or an error message to
 * return to the caller.
 */
export async function checkUsageLimit(db: Db, monthlyLimit: number | null, limitEnforced: boolean): Promise<string | null> {
  if (!limitEnforced || monthlyLimit === null) return null;

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM((${auditTrail.changes}->>'tokens')::int), 0)` })
    .from(auditTrail)
    .where(and(gte(auditTrail.createdAt, startOfMonth)));

  const usedThisMonth = row?.total ?? 0;
  if (usedThisMonth >= monthlyLimit) return "AI usage limit reached for this company.";
  return null;
}

/**
 * Loads a company's row and turns its aiConfig into the provider/apiKey/model
 * overrides callLlm/callLlmDetailed accept — the same lookup+decrypt
 * ai.assistant.ts already did inline, shared here so every new AI pipeline
 * uses the company's own configured key when set, falling back to the
 * platform's global env config exactly like every existing pipeline.
 */
export async function loadCompanyLlmOptions(db: Db): Promise<{ co: typeof company.$inferSelect | undefined; llmOptions: LlmCallOptions }> {
  const [co] = await db.select().from(company);
  const aiConfig = co?.aiConfig ?? {};

  // A real, live-reproduced bug (found testing the rebuilt AI Insights
  // dashboard): decryptSecret throws if the stored ciphertext can't be
  // authenticated under the CURRENT AI_CONFIG_ENCRYPTION_KEY — e.g.
  // after a real key rotation, or any other way stored ciphertext and the
  // active key fall out of sync. That's exactly as recoverable as "no key
  // configured" (every pipeline already has a clean stub path for that),
  // so it's treated the same way instead of crashing the whole request
  // with an unhandled 500 — this app's own AI philosophy is to degrade to
  // a labeled stub, never to error out, whenever a real call can't be made.
  let apiKey: string | undefined;
  if (aiConfig.apiKeyEncrypted) {
    try {
      apiKey = decryptSecret(aiConfig.apiKeyEncrypted);
    } catch (err) {
      logger.warn("Company AI config key failed to decrypt — falling back to stub mode for this call", { err: err instanceof Error ? err.message : err });
    }
  }

  return {
    co,
    llmOptions: {
      provider: aiConfig.provider,
      apiKey,
      model: aiConfig.modelName,
      temperature: aiConfig.temperature,
      maxTokens: aiConfig.maxTokens,
    },
  };
}

/**
 * Saves one ai_suggestions row plus its audit trail entry, capturing real
 * token usage/cost from a `callLlmDetailed` result — the same shape
 * ai.assistant.ts already records for every assistant message. Originally
 * each of the 4 newer AI pipelines (Work Order Planning, PR Justification,
 * Onboarding, ERP Automation) called the plain `callLlm` (text-only,
 * discards usage) and logged only `{ module, pipeline }`, so their real
 * spend never showed up in Admin → AI Usage and never counted toward
 * `checkUsageLimit`'s sum above despite this function's own company-wide
 * scope — found live in the QA sweep review. Every new AI pipeline should
 * call this (via `callLlmDetailed`, not `callLlm`) instead of inserting
 * into `aiSuggestions` by hand.
 */
export async function recordAiSuggestion(
  db: Db,
  params: {
    module: string;
    pipeline: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    result: LlmCallResult;
    performedBy: number | undefined;
    /** Phase 4 guardrails — defaults to "ok" for the pre-Phase-4 callers (ai.assistant.ts, Work Order/PR/ERP Automation/Risk pipelines) that never produced anything but a real, well-shaped response or a stub. */
    status?: AiOutputStatus;
    errorMessage?: string | null;
    /** The verb describeAiState uses for a real ("ok") response — lets a drafting pipeline (CAPA plan, 8D, supplier message, form autofill) read "AI-drafted" in the audit trail instead of the generic "AI-suggested" a scoring/analysis pipeline gets. */
    okVerb?: string;
  }
): Promise<typeof aiSuggestions.$inferSelect> {
  const { module, pipeline, input, output, result, performedBy, status = "ok", errorMessage = null, okVerb } = params;
  const totalTokens = result.usage ? result.usage.inputTokens + result.usage.outputTokens : null;
  // Only a real provider response has real usage to bill/track — the
  // honest no-key stub (result.usage === null) never touches cost, same
  // as ai.assistant.ts's own rule.
  const cost = result.usage ? estimateCost(result.model, result.usage.inputTokens, result.usage.outputTokens) : 0;

  const [saved] = await db
    .insert(aiSuggestions)
    .values({ module, pipeline, input, output, status, errorMessage, createdBy: performedBy })
    .returning();

  await recordAuditTrail(db, {
    entityType: "AiSuggestion",
    entityId: saved!.id,
    action: "create",
    changes: {
      module,
      pipeline,
      usedModel: result.model,
      tokens: totalTokens,
      tokensIn: result.usage?.inputTokens ?? null,
      tokensOut: result.usage?.outputTokens ?? null,
      cost,
      status,
      errorMessage,
      aiState: describeAiState(status, okVerb),
    },
    performedBy,
  });

  return saved!;
}

/**
 * The one call site every `ai.controller.ts` handler now goes through:
 * checks the company's usage limit, runs the pipeline with the company's BYOK
 * options, and always records a row — "ok"/"stub"/"malformed" from the
 * pipeline's own guardrail check (see ai.guardrails.ts), or "error" (a real
 * provider failure after retries, e.g. rate-limit exhaustion or a network
 * error) caught here so a failed attempt still leaves an audit trail entry
 * instead of silently throwing past asyncHandler with no record at all —
 * the "AI degraded mode" hook the AI Enablement phase asked for. Re-throws
 * after logging an "error" row, so the client still gets a real error
 * response; this only changes what gets recorded, not the request's outcome.
 */
export async function runPipelineAndRecord(
  db: Db,
  performedBy: number | undefined,
  module: string,
  pipeline: string,
  input: Record<string, unknown>,
  okVerb: string,
  runner: (llmOptions: LlmCallOptions) => Promise<PipelineRun>
): Promise<{ suggestion: typeof aiSuggestions.$inferSelect; output: Record<string, unknown> }> {
  const [co] = await db.select().from(company);
  const limitError = await checkUsageLimit(db, co?.aiMonthlyLimit ?? null, co?.aiLimitEnforced ?? false);
  if (limitError) throw AppError.forbidden(limitError);

  const { llmOptions } = await loadCompanyLlmOptions(db);

  try {
    const { classified, result } = await runner(llmOptions);

    // "strict" safety mode (Settings → Company AI Config): a malformed
    // response is refused outright — recorded for the audit trail exactly
    // like "standard" mode would, but the request itself fails with a clear
    // error instead of returning a 200 the caller might render as if it
    // were a real (if flagged) suggestion.
    if (classified.status === "malformed" && co?.aiConfig?.safetyMode === "strict") {
      await recordAiSuggestion(db, { module, pipeline, input, output: classified.data, result, performedBy, status: classified.status, errorMessage: classified.errorMessage, okVerb });
      throw new AppError(classified.errorMessage ?? "The AI response didn't match the expected shape and was refused under this company's strict safety mode.", 502);
    }

    const suggestion = await recordAiSuggestion(db, {
      module,
      pipeline,
      input,
      output: classified.data,
      result,
      performedBy,
      status: classified.status,
      errorMessage: classified.errorMessage,
      okVerb,
    });
    return { suggestion, output: classified.data };
  } catch (err) {
    if (err && typeof err === "object" && "statusCode" in err) throw err; // AppError from checkUsageLimit or an already-classified case above — pass through unchanged
    const message = err instanceof Error ? err.message : "The AI provider request failed.";
    logger.error("AI pipeline call failed", { module, pipeline, err });
    const [saved] = await db
      .insert(aiSuggestions)
      .values({ module, pipeline, input, output: {}, status: "error", errorMessage: message, createdBy: performedBy })
      .returning();
    await recordAuditTrail(db, {
      entityType: "AiSuggestion",
      entityId: saved!.id,
      action: "create",
      changes: { module, pipeline, status: "error", errorMessage: message, aiState: describeAiState("error") },
      performedBy,
    });
    throw new AppError("The AI provider request failed — please try again.", 502);
  }
}
