import { and, eq, gte, sql } from "drizzle-orm";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { decryptSecret } from "../tenant/crypto.js";
import type { TenantDb } from "../../lib/tenantScope.js";
import type { LlmCallOptions } from "./llm-gateway.js";

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
