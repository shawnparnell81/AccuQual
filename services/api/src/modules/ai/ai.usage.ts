import { and, eq, gte, sql } from "drizzle-orm";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { aiSuggestions } from "../../drizzle/schema/ai.js";
import { decryptSecret } from "../tenant/crypto.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { estimateCost } from "./pricing.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import type { LlmCallOptions, LlmCallResult } from "./llm-gateway.js";

/**
 * BYOK monthly limit enforcement, shared by every AI endpoint that spends
 * tokens (originally lived only inside ai.assistant.ts's assistantHandler;
 * extracted here once the AI Work Order Planning / PR Justification /
 * ERP Automation pipelines needed the exact same check — see the AI
 * modules review). Checked before every real call, not against a stored
 * counter: a single cumulative field can't implement "monthly" without
 * something resetting it, and this app has no background jobs to do that
 * reset, so this instead sums this tenant's own real audit_trail rows
 * carrying a `tokens` field from the 1st of the current calendar month
 * onward. Deliberately NOT filtered to one entityType — tenants.aiMonthlyLimit
 * is documented as an overall BYOK usage cap, not one scoped to a single
 * feature, so every AI pipeline's spend counts against the same limit.
 * Returns null when under limit (or no limit set), or an error message to
 * return to the caller.
 */
export async function checkUsageLimit(db: TenantDb, tenantId: number, monthlyLimit: number | null, limitEnforced: boolean): Promise<string | null> {
  if (!limitEnforced || monthlyLimit === null) return null;

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const [row] = await db
    .select({ total: sql<number>`COALESCE(SUM((${auditTrail.changes}->>'tokens')::int), 0)` })
    .from(auditTrail)
    .where(and(eq(auditTrail.tenantId, tenantId), gte(auditTrail.createdAt, startOfMonth)));

  const usedThisMonth = row?.total ?? 0;
  if (usedThisMonth >= monthlyLimit) return "AI usage limit reached for this tenant.";
  return null;
}

/**
 * Loads a tenant's row and turns its aiConfig into the provider/apiKey/model
 * overrides callLlm/callLlmDetailed accept — the same lookup+decrypt
 * ai.assistant.ts already did inline, shared here so every new AI pipeline
 * uses the tenant's own configured key when set, falling back to the
 * platform's global env config exactly like every existing pipeline.
 */
export async function loadTenantLlmOptions(db: TenantDb, tenantId: number): Promise<{ tenant: typeof tenants.$inferSelect | undefined; llmOptions: LlmCallOptions }> {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, tenantId));
  const aiConfig = tenant?.aiConfig ?? {};
  return {
    tenant,
    llmOptions: {
      provider: aiConfig.provider,
      apiKey: aiConfig.apiKeyEncrypted ? decryptSecret(aiConfig.apiKeyEncrypted) : undefined,
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
 * `checkUsageLimit`'s sum above despite this function's own tenant-wide
 * scope — found live in the QA sweep review. Every new AI pipeline should
 * call this (via `callLlmDetailed`, not `callLlm`) instead of inserting
 * into `aiSuggestions` by hand.
 */
export async function recordAiSuggestion(
  db: TenantDb,
  params: {
    tenantId: number;
    module: string;
    pipeline: string;
    input: Record<string, unknown>;
    output: Record<string, unknown>;
    result: LlmCallResult;
    performedBy: number | undefined;
  }
): Promise<typeof aiSuggestions.$inferSelect> {
  const { tenantId, module, pipeline, input, output, result, performedBy } = params;
  const totalTokens = result.usage ? result.usage.inputTokens + result.usage.outputTokens : null;
  // Only a real provider response has real usage to bill/track — the
  // honest no-key stub (result.usage === null) never touches cost, same
  // as ai.assistant.ts's own rule.
  const cost = result.usage ? estimateCost(result.model, result.usage.inputTokens, result.usage.outputTokens) : 0;

  const [saved] = await db
    .insert(aiSuggestions)
    .values({ tenantId, module, pipeline, input, output, createdBy: performedBy })
    .returning();

  await recordAuditTrail(db, {
    tenantId,
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
    },
    performedBy,
  });

  return saved!;
}
