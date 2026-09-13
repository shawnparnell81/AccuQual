import type { Request, Response } from "express";
import { eq } from "drizzle-orm";
import { tenants } from "../../drizzle/schema/tenants.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto.js";

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
  });
});

export const updateAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const tenant = await loadTenant(req);
  const { provider, apiKey, modelName, temperature, maxTokens, assistantName } = req.body as {
    provider?: string;
    apiKey?: string;
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    assistantName?: string;
  };

  const merged = { ...tenant.aiConfig };
  if (provider !== undefined) merged.provider = provider as "anthropic" | "openai";
  if (apiKey !== undefined) merged.apiKeyEncrypted = encryptSecret(apiKey);
  if (modelName !== undefined) merged.modelName = modelName;
  if (temperature !== undefined) merged.temperature = temperature;
  if (maxTokens !== undefined) merged.maxTokens = maxTokens;
  if (assistantName !== undefined) merged.assistantName = assistantName || undefined;

  await req.db!.update(tenants).set({ aiConfig: merged }).where(eq(tenants.id, req.tenantId!));
  // Never log apiKey itself, encrypted or not — only what changed and to what non-secret values.
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "Tenant",
    entityId: req.tenantId!,
    action: "update",
    changes: { action: "update_ai_config", provider: merged.provider, modelName: merged.modelName, assistantName: merged.assistantName, apiKeyChanged: apiKey !== undefined },
    performedBy: req.user?.id,
  });

  res.json({
    provider: merged.provider ?? null,
    modelName: merged.modelName ?? null,
    temperature: merged.temperature ?? null,
    maxTokens: merged.maxTokens ?? null,
    assistantName: merged.assistantName ?? null,
    hasApiKey: !!merged.apiKeyEncrypted,
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
