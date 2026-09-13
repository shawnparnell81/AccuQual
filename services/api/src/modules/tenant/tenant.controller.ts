import type { Request, Response } from "express";
import { eq, and, gte, sql } from "drizzle-orm";
import { tenants } from "../../drizzle/schema/tenants.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto.js";
import { validateApiKey } from "../ai/llm-gateway.js";
import { env } from "../../config/env.js";

/**
 * Self-service settings for the CURRENT tenant only, scoped by req.tenantId
 * (set by withTenantDb) — never a foreign tenant id in the URL. Cross-tenant
 * management (any tenant, by a platform_admin) is a different, existing
 * surface: modules/platform. This module is "my own tenant's admin
 * settings", the same distinction Settings vs. Platform Administration
 * already draws in the frontend.
 */
async function loadTenant(req: Request) {
  const [tenant] = await req.db!.select().from(tenants).where(eq(tenants.id, req.tenantId!));
  if (!tenant) throw AppError.notFound("Tenant");
  return tenant;
}

export const getBrandingHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  res.json(tenant.branding ?? {});
});

export const updateBrandingHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const body = req.body as Record<string, string>;
  // "" clears a field back to unset rather than storing an empty string forever.
  const patch = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "" ? undefined : v]));
  const merged = { ...tenant.branding, ...patch };
  const fieldsChanged = Object.keys(body);

  const [updated] = await req.db!.update(tenants).set({ branding: merged }).where(eq(tenants.id, req.tenantId!)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "Tenant", entityId: req.tenantId!, action: "update", changes: { fieldsChanged }, performedBy: req.user?.id });
  res.json(updated!.branding);
});

/** Never returns the real key — a masked display string + whether one is set at all, same convention as a password field showing dots. */
export const getAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const config = tenant.aiConfig ?? {};
  res.json({
    provider: config.provider ?? null,
    modelName: config.modelName ?? null,
    temperature: config.temperature ?? null,
    maxTokens: config.maxTokens ?? null,
    assistantName: config.assistantName ?? null,
    hasApiKey: !!config.apiKeyEncrypted,
    maskedApiKey: config.apiKeyEncrypted ? maskSecret(decryptSecret(config.apiKeyEncrypted)) : null,
    monthlyLimit: tenant.aiMonthlyLimit,
    limitEnforced: tenant.aiLimitEnforced,
  });
});

export const updateAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const { provider, apiKey, modelName, temperature, maxTokens, assistantName, monthlyLimit, limitEnforced } = req.body as {
    provider?: string;
    apiKey?: string;
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    assistantName?: string;
    monthlyLimit?: number | null;
    limitEnforced?: boolean;
  };

  const merged = { ...tenant.aiConfig };
  if (provider !== undefined) merged.provider = provider as "anthropic" | "openai";
  if (modelName !== undefined) merged.modelName = modelName;
  if (temperature !== undefined) merged.temperature = temperature;
  if (maxTokens !== undefined) merged.maxTokens = maxTokens;
  if (assistantName !== undefined) merged.assistantName = assistantName || undefined;

  if (apiKey !== undefined) {
    // A real, minimal call to the provider — see validateApiKey's own
    // comment. Tests against whatever provider/model this save ends up
    // with (the merged values, so changing provider+key in the same
    // request validates against the NEW provider, not the stale one).
    const testProvider = merged.provider ?? "anthropic";
    const testModel = merged.modelName ?? env.LLM_MODEL;
    const isValid = await validateApiKey(testProvider, apiKey, testModel);
    if (!isValid) throw AppError.badRequest("Couldn't validate this API key with the provider — check the key, provider, and model, then try again.");
    merged.apiKeyEncrypted = encryptSecret(apiKey);
  }

  const flatPatch: { aiMonthlyLimit?: number | null; aiLimitEnforced?: boolean } = {};
  if (monthlyLimit !== undefined) flatPatch.aiMonthlyLimit = monthlyLimit;
  if (limitEnforced !== undefined) flatPatch.aiLimitEnforced = limitEnforced;

  const [updated] = await req.db!.update(tenants).set({ aiConfig: merged, ...flatPatch }).where(eq(tenants.id, req.tenantId!)).returning();

  // Never log apiKey itself, encrypted or not — only what changed and to what non-secret values.
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "Tenant",
    entityId: req.tenantId!,
    action: "update",
    changes: {
      action: "update_ai_config",
      fieldsChanged: Object.keys(req.body),
      provider: merged.provider,
      modelName: merged.modelName,
      assistantName: merged.assistantName,
      apiKeyChanged: apiKey !== undefined,
      monthlyLimit: updated!.aiMonthlyLimit,
      limitEnforced: updated!.aiLimitEnforced,
    },
    performedBy: req.user?.id,
  });

  res.json({
    provider: merged.provider ?? null,
    modelName: merged.modelName ?? null,
    temperature: merged.temperature ?? null,
    maxTokens: merged.maxTokens ?? null,
    assistantName: merged.assistantName ?? null,
    hasApiKey: !!merged.apiKeyEncrypted,
    monthlyLimit: updated!.aiMonthlyLimit,
    limitEnforced: updated!.aiLimitEnforced,
  });
});

/**
 * The BYOK usage dashboard's one data source — admin only (see
 * tenant.routes.ts). totalTokens/totalCost are the all-time cumulative
 * columns (fast, always available); currentMonthTokens/dailyBreakdown/
 * moduleBreakdown are computed live from real audit_trail rows (every real
 * /ai/assistant call already writes one — see ai.assistant.ts), which is
 * also exactly how limit enforcement itself decides "this month's usage"
 * (see ai.assistant.ts's checkUsageLimit) — the dashboard and the
 * enforcement it explains are reading the same real numbers.
 */
export const getAiUsageHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const tenantId = req.tenantId!;

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const windowStart = startOfMonth < thirtyDaysAgo ? startOfMonth : thirtyDaysAgo;

  const rows = await req
    .db!.select({
      createdAt: auditTrail.createdAt,
      module: sql<string | null>`${auditTrail.changes}->>'module'`,
      tokens: sql<number>`COALESCE((${auditTrail.changes}->>'tokens')::int, 0)`,
    })
    .from(auditTrail)
    .where(and(eq(auditTrail.tenantId, tenantId), eq(auditTrail.entityType, "AiAssistantMessage"), gte(auditTrail.createdAt, windowStart)));

  const currentMonthTokens = rows.filter((r) => (r.createdAt ?? new Date(0)) >= startOfMonth).reduce((sum, r) => sum + r.tokens, 0);

  const last30 = rows.filter((r) => (r.createdAt ?? new Date(0)) >= thirtyDaysAgo);

  const byDay = new Map<string, number>();
  for (const r of last30) {
    const day = (r.createdAt ?? new Date()).toISOString().slice(0, 10);
    byDay.set(day, (byDay.get(day) ?? 0) + r.tokens);
  }
  const dailyBreakdown = Array.from(byDay.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, tokens]) => ({ label: new Date(`${date}T00:00:00Z`).toLocaleDateString(undefined, { month: "short", day: "numeric" }), count: tokens }));

  const byModule = new Map<string, { tokens: number; calls: number }>();
  for (const r of last30) {
    const key = r.module ?? "general";
    const entry = byModule.get(key) ?? { tokens: 0, calls: 0 };
    entry.tokens += r.tokens;
    entry.calls += 1;
    byModule.set(key, entry);
  }
  const moduleBreakdown = Array.from(byModule.entries())
    .map(([module, v]) => ({ module, ...v }))
    .sort((a, b) => b.tokens - a.tokens);

  const monthlyLimit = tenant.aiMonthlyLimit;
  const remainingTokens = tenant.aiLimitEnforced && monthlyLimit !== null ? Math.max(monthlyLimit - currentMonthTokens, 0) : null;

  res.json({
    totalTokens: tenant.aiUsageTokens,
    totalCost: Number(tenant.aiUsageCost),
    monthlyLimit,
    limitEnforced: tenant.aiLimitEnforced,
    currentMonthTokens,
    remainingTokens,
    dailyBreakdown,
    moduleBreakdown,
  });
});

/**
 * The one AI-config field ANY authenticated user can read (not just admin)
 * — the floating Assistant panel needs to show "Chat with <name>" for
 * everyone, per "the assistant must work for ANY user in ANY department".
 * Everything else about the config (provider, masked key, etc.) stays
 * admin-only via getAiConfigHandler above.
 */
export const getAssistantNameHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  res.json({ assistantName: tenant.aiConfig?.assistantName ?? null });
});
