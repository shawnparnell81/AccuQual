import type { Request, Response } from "express";
import { eq, and, gte, inArray, sql } from "drizzle-orm";
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

/**
 * Never returns the real key — a masked display string + whether one is set
 * at all, same convention as a password field showing dots.
 *
 * `keyStatus` is Phase 4's "prepare for external LLM key" tri-state: "ready"
 * (this tenant, or the platform default, has a key — real calls will be
 * made), "missing" (neither does — every AI feature runs in stub mode).
 * There is no third "invalid" value to report here: updateAiConfigHandler
 * below makes a real validation call to the provider before a key is ever
 * encrypted/stored, so an invalid key can never actually be saved — the
 * rejection happens at save time (a 400 on that request), not as a
 * lingering stored state to warn about later.
 */
/**
 * GET/PATCH /tenant/profile — Admin Console "Tenant Settings" (Phase 10):
 * name, logo, timezone, contact info as one consolidated section, per the
 * roadmap's own grouping. Reuses `tenants.name` and `branding.logoUrl`
 * rather than storing the name/logo a second time — this endpoint is a
 * convenience view over fields that already exist plus the two genuinely
 * new ones (timezone, contact), not a new source of truth for name/logo.
 */
export const getProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  res.json({
    name: tenant.name,
    code: tenant.code,
    logoUrl: tenant.branding?.logoUrl ?? null,
    timezone: tenant.profile?.timezone ?? null,
    contactName: tenant.profile?.contactName ?? null,
    contactEmail: tenant.profile?.contactEmail ?? null,
    contactPhone: tenant.profile?.contactPhone ?? null,
  });
});

export const updateProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const { name, logoUrl, ...profileFields } = req.body as { name?: string; logoUrl?: string } & Record<string, string | undefined>;

  const patch: { name?: string; branding?: typeof tenant.branding; profile?: typeof tenant.profile } = {};
  if (name !== undefined) patch.name = name;
  if (logoUrl !== undefined) patch.branding = { ...tenant.branding, logoUrl: logoUrl === "" ? undefined : logoUrl };

  const mergedProfile = { ...tenant.profile };
  for (const [key, value] of Object.entries(profileFields)) {
    if (value !== undefined) (mergedProfile as Record<string, string | undefined>)[key] = value === "" ? undefined : value;
  }
  patch.profile = mergedProfile;

  const [updated] = await req.db!.update(tenants).set(patch).where(eq(tenants.id, req.tenantId!)).returning();
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "Tenant",
    entityId: req.tenantId!,
    action: "update",
    changes: { action: "update_profile", fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });

  res.json({
    name: updated!.name,
    code: updated!.code,
    logoUrl: updated!.branding?.logoUrl ?? null,
    timezone: updated!.profile?.timezone ?? null,
    contactName: updated!.profile?.contactName ?? null,
    contactEmail: updated!.profile?.contactEmail ?? null,
    contactPhone: updated!.profile?.contactPhone ?? null,
  });
});

export const getAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const config = tenant.aiConfig ?? {};
  const keyStatus: "ready" | "missing" = config.apiKeyEncrypted || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY ? "ready" : "missing";
  res.json({
    provider: config.provider ?? null,
    modelName: config.modelName ?? null,
    temperature: config.temperature ?? null,
    maxTokens: config.maxTokens ?? null,
    assistantName: config.assistantName ?? null,
    safetyMode: config.safetyMode ?? "standard",
    hasApiKey: !!config.apiKeyEncrypted,
    maskedApiKey: config.apiKeyEncrypted ? maskSecret(decryptSecret(config.apiKeyEncrypted)) : null,
    keyStatus,
    monthlyLimit: tenant.aiMonthlyLimit,
    limitEnforced: tenant.aiLimitEnforced,
  });
});

export const updateAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const { provider, apiKey, modelName, temperature, maxTokens, assistantName, safetyMode, monthlyLimit, limitEnforced } = req.body as {
    provider?: string;
    apiKey?: string;
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    assistantName?: string;
    safetyMode?: "standard" | "strict";
    monthlyLimit?: number | null;
    limitEnforced?: boolean;
  };

  const merged = { ...tenant.aiConfig };
  if (provider !== undefined) merged.provider = provider as "anthropic" | "openai";
  if (modelName !== undefined) merged.modelName = modelName;
  if (temperature !== undefined) merged.temperature = temperature;
  if (maxTokens !== undefined) merged.maxTokens = maxTokens;
  if (assistantName !== undefined) merged.assistantName = assistantName || undefined;
  if (safetyMode !== undefined) merged.safetyMode = safetyMode;

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
    safetyMode: merged.safetyMode ?? "standard",
    hasApiKey: !!merged.apiKeyEncrypted,
    keyStatus: merged.apiKeyEncrypted || env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY ? "ready" : "missing",
    monthlyLimit: updated!.aiMonthlyLimit,
    limitEnforced: updated!.aiLimitEnforced,
  });
});

/**
 * The BYOK usage dashboard's one data source — admin only (see
 * tenant.routes.ts). totalTokens/totalCost are the all-time cumulative
 * columns (fast, always available); currentMonthTokens/dailyBreakdown/
 * moduleBreakdown are computed live from real audit_trail rows — every
 * real /ai/assistant call writes one with entityType "AiAssistantMessage"
 * (see ai.assistant.ts), and every other real AI pipeline built since
 * (Work Order Planning, PR Justification, Onboarding, ERP Automation)
 * writes one with entityType "AiSuggestion" via ai.usage.ts's
 * recordAiSuggestion — both carry the same `module`/`tokens` shape in
 * `changes`, so both are counted here. This is also exactly how limit
 * enforcement itself decides "this month's usage" (see ai.usage.ts's
 * checkUsageLimit, which sums every entity type's tokens tenant-wide) —
 * the dashboard and the enforcement it explains read the same real
 * numbers. Previously scoped to "AiAssistantMessage" only, which silently
 * left every other pipeline's real spend invisible here even though it
 * already counted against the limit — see the QA sweep review.
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
    .where(and(eq(auditTrail.tenantId, tenantId), inArray(auditTrail.entityType, ["AiAssistantMessage", "AiSuggestion"]), gte(auditTrail.createdAt, windowStart)));

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

/** Who in this organization must use multi-factor authentication. Readable by any signed-in user (the UI explains the policy); only an admin changes it. */
export const getSecurityHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  res.json({ mfaPolicy: tenant.mfaPolicy });
});

export const updateSecurityHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const { mfaPolicy } = req.body as { mfaPolicy: "optional" | "admins" | "all" };
  await req.db!.update(tenants).set({ mfaPolicy }).where(eq(tenants.id, req.tenantId!));
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "Tenant",
    entityId: req.tenantId!,
    action: "update",
    changes: { setting: "mfaPolicy", from: tenant.mfaPolicy, to: mfaPolicy },
    performedBy: req.user?.id,
  });
  res.json({ mfaPolicy });
});

/** First-run onboarding checklist — open to any signed-in user (the dashboard shows it), same as branding/profile above. Reads back a sane default for a tenant created before this shipped and never backfilled, rather than null. */
export const getOnboardingHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  res.json(tenant.onboardingProgress ?? { dismissed: false, completedItems: [] });
});

/** Marks one item complete, and/or dismisses the whole checklist — admin-only, same as every other tenant-settings PATCH here. Merge-patch: a body with only `completedItems` leaves `dismissed` as it was, and vice versa. */
export const updateOnboardingHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const existing = tenant.onboardingProgress ?? { dismissed: false, completedItems: [] };
  const body = req.body as { completedItems?: string[]; dismissed?: boolean };
  const merged = { dismissed: body.dismissed ?? existing.dismissed, completedItems: body.completedItems ?? existing.completedItems };
  await req.db!.update(tenants).set({ onboardingProgress: merged }).where(eq(tenants.id, req.tenantId!));
  res.json(merged);
});
