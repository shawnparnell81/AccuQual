import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, gte, inArray, sql } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret, decryptSecret, maskSecret } from "./crypto.js";
import { validateApiKey } from "../ai/llm-gateway.js";
import { env } from "../../config/env.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { sessionLengthHoursFromProfile } from "../auth/sessionLength.js";
import { navigationLayoutFromProfile } from "./navigationLayout.js";

/**
 * Self-service settings for the company
 * (set by withDb) — never a foreign co id in the URL. Cross-co
 * management (any co, by a platform_admin) is a different, existing
 * surface: modules/platform. This module is "my own co's admin
 * settings", the same distinction Settings vs. Platform Administration
 * already draws in the frontend.
 */
async function loadCompany(req: Request) {
  const [co] = await req.db!.select().from(company);
  if (!co) throw AppError.notFound("Company");
  return co;
}

export const getBrandingHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  res.json(co.branding ?? {});
});

export const updateBrandingHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const body = req.body as Record<string, string>;
  // "" clears a field back to unset rather than storing an empty string forever.
  const patch = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "" ? undefined : v]));
  const merged = { ...co.branding, ...patch };
  const fieldsChanged = Object.keys(body);

  const [updated] = await req.db!.update(company).set({ branding: merged }).returning();
  await recordAuditTrail(req.db!, { entityType: "Company", entityId: 1, action: "update", changes: { fieldsChanged }, performedBy: req.user?.id });
  res.json(updated!.branding);
});

/**
 * Never returns the real key — a masked display string + whether one is set
 * at all, same convention as a password field showing dots.
 *
 * `keyStatus` is Phase 4's "prepare for external LLM key" tri-state: "ready"
 * (this co, or the platform default, has a key — real calls will be
 * made), "missing" (neither does — every AI feature runs in stub mode).
 * There is no third "invalid" value to report here: updateAiConfigHandler
 * below makes a real validation call to the provider before a key is ever
 * encrypted/stored, so an invalid key can never actually be saved — the
 * rejection happens at save time (a 400 on that request), not as a
 * lingering stored state to warn about later.
 */
/**
 * GET/PATCH /co/profile — Admin Console "Company Settings" (Phase 10):
 * name, logo, timezone, contact info as one consolidated section, per the
 * roadmap's own grouping. Reuses `companies.name` and `branding.logoUrl`
 * rather than storing the name/logo a second time — this endpoint is a
 * convenience view over fields that already exist plus the two genuinely
 * new ones (timezone, contact), not a new source of truth for name/logo.
 */
export const getProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  res.json({
    name: co.name,
    logoUrl: co.branding?.logoUrl ?? null,
    timezone: co.profile?.timezone ?? null,
    contactName: co.profile?.contactName ?? null,
    contactEmail: co.profile?.contactEmail ?? null,
    contactPhone: co.profile?.contactPhone ?? null,
    navigationLayout: navigationLayoutFromProfile(co.profile),
  });
});

export const updateProfileHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const { name, logoUrl, ...profileFields } = req.body as { name?: string; logoUrl?: string } & Record<string, string | undefined>;

  const patch: { name?: string; branding?: typeof co.branding; profile?: typeof co.profile } = {};
  if (name !== undefined) patch.name = name;
  if (logoUrl !== undefined) patch.branding = { ...co.branding, logoUrl: logoUrl === "" ? undefined : logoUrl };

  const mergedProfile = { ...co.profile };
  for (const [key, value] of Object.entries(profileFields)) {
    if (value !== undefined) (mergedProfile as Record<string, string | undefined>)[key] = value === "" ? undefined : value;
  }
  patch.profile = mergedProfile;

  const [updated] = await req.db!.update(company).set(patch).returning();
  await recordAuditTrail(req.db!, {
    entityType: "Company",
    entityId: 1,
    action: "update",
    changes: { action: "update_profile", fieldsChanged: Object.keys(req.body) },
    performedBy: req.user?.id,
  });

  res.json({
    name: updated!.name,
    logoUrl: updated!.branding?.logoUrl ?? null,
    timezone: updated!.profile?.timezone ?? null,
    contactName: updated!.profile?.contactName ?? null,
    contactEmail: updated!.profile?.contactEmail ?? null,
    contactPhone: updated!.profile?.contactPhone ?? null,
    navigationLayout: navigationLayoutFromProfile(updated!.profile),
  });
});

export const getAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const config = co.aiConfig ?? {};
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
    monthlyLimit: co.aiMonthlyLimit,
    limitEnforced: co.aiLimitEnforced,
  });
});

export const updateAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
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

  const merged = { ...co.aiConfig };
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

  const [updated] = await req.db!.update(company).set({ aiConfig: merged, ...flatPatch }).returning();

  // Never log apiKey itself, encrypted or not — only what changed and to what non-secret values.
  await recordAuditTrail(req.db!, {
    entityType: "Company",
    entityId: 1,
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
 * co.routes.ts). totalTokens/totalCost are the all-time cumulative
 * columns (fast, always available); currentMonthTokens/dailyBreakdown/
 * moduleBreakdown are computed live from real audit_trail rows — every
 * real /ai/assistant call writes one with entityType "AiAssistantMessage"
 * (see ai.assistant.ts), and every other real AI pipeline built since
 * (Work Order Planning, PR Justification, Onboarding, ERP Automation)
 * writes one with entityType "AiSuggestion" via ai.usage.ts's
 * recordAiSuggestion — both carry the same `module`/`tokens` shape in
 * `changes`, so both are counted here. This is also exactly how limit
 * enforcement itself decides "this month's usage" (see ai.usage.ts's
 * checkUsageLimit, which sums every entity type's tokens co-wide) —
 * the dashboard and the enforcement it explains read the same real
 * numbers. Previously scoped to "AiAssistantMessage" only, which silently
 * left every other pipeline's real spend invisible here even though it
 * already counted against the limit.
 */
export const getAiUsageHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);

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
    .where(and(inArray(auditTrail.entityType, ["AiAssistantMessage", "AiSuggestion"]), gte(auditTrail.createdAt, windowStart)));

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

  const monthlyLimit = co.aiMonthlyLimit;
  const remainingTokens = co.aiLimitEnforced && monthlyLimit !== null ? Math.max(monthlyLimit - currentMonthTokens, 0) : null;

  res.json({
    totalTokens: co.aiUsageTokens,
    totalCost: Number(co.aiUsageCost),
    monthlyLimit,
    limitEnforced: co.aiLimitEnforced,
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
  const co = await loadCompany(req);
  res.json({ assistantName: co.aiConfig?.assistantName ?? null });
});

/** Who must use multi-factor authentication, and how long a sign-in lasts. Readable by any signed-in user; only an admin changes it. The length is the whole company, not a role. */
export const getSecurityHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  res.json({ mfaPolicy: co.mfaPolicy, sessionLengthHours: sessionLengthHoursFromProfile(co.profile) });
});

export const updateSecurityHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const { mfaPolicy, sessionLengthHours } = req.body as { mfaPolicy?: "optional" | "admins" | "all"; sessionLengthHours?: number };
  const previousHours = sessionLengthHoursFromProfile(co.profile);
  const patch: { mfaPolicy?: "optional" | "admins" | "all"; profile?: typeof co.profile } = {};
  if (mfaPolicy !== undefined) patch.mfaPolicy = mfaPolicy;
  if (sessionLengthHours !== undefined) patch.profile = { ...co.profile, sessionLengthHours };

  if (Object.keys(patch).length > 0) await req.db!.update(company).set(patch);
  if (mfaPolicy !== undefined) {
    await recordAuditTrail(req.db!, {
      entityType: "Company",
      entityId: 1,
      action: "update",
      changes: { setting: "mfaPolicy", from: co.mfaPolicy, to: mfaPolicy },
      performedBy: req.user?.id,
    });
  }
  if (sessionLengthHours !== undefined && sessionLengthHours !== previousHours) {
    await recordAuditTrail(req.db!, {
      entityType: "Company",
      entityId: 1,
      action: "update",
      changes: { setting: "sessionLengthHours", from: previousHours, to: sessionLengthHours },
      performedBy: req.user?.id,
    });
  }
  res.json({ mfaPolicy: mfaPolicy ?? co.mfaPolicy, sessionLengthHours: sessionLengthHours ?? previousHours });
});

/** First-run onboarding checklist — open to any signed-in user (the dashboard shows it), same as branding/profile above. Reads back a sane default for a co created before this shipped and never backfilled, rather than null. */
export const getOnboardingHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  res.json(co.onboardingProgress ?? { dismissed: false, completedItems: [] });
});

/** Marks one item complete, and/or dismisses the whole checklist — admin-only, same as every other co-settings PATCH here. Merge-patch: a body with only `completedItems` leaves `dismissed` as it was, and vice versa. */
export const updateOnboardingHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const existing = co.onboardingProgress ?? { dismissed: false, completedItems: [] };
  const body = req.body as { completedItems?: string[]; dismissed?: boolean };
  const merged = { dismissed: body.dismissed ?? existing.dismissed, completedItems: body.completedItems ?? existing.completedItems };
  await req.db!.update(company).set({ onboardingProgress: merged });
  res.json(merged);
});

function sidebarKeysRepeat(nodes: { key: string; children?: { key: string; children?: unknown[] }[] }[], seen = new Set<string>()): boolean {
  for (const node of nodes) {
    if (seen.has(node.key)) return true;
    seen.add(node.key);
    const children = (node.children ?? []) as { key: string; children?: { key: string; children?: unknown[] }[] }[];
    if (sidebarKeysRepeat(children, seen)) return true;
  }
  return false;
}

/** Anyone signed in can read the arrangement. Who can open each item is still decided in the app. */
export const getSidebarLayoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  res.json({ layout: co.sidebarLayout ?? null });
});

/** Owner and administrator only. Other roles are rejected before this runs. */
export const updateSidebarLayoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const { layout } = req.body as { layout: { key: string; children?: { key: string; children?: unknown[] }[] }[] };
  if (sidebarKeysRepeat(layout)) throw AppError.badRequest("Each sidebar item can only appear once");
  await req.db!.update(company).set({ sidebarLayout: layout });
  await recordAuditTrail(req.db!, {
    entityType: "Company",
    entityId: co.id,
    action: "update",
    changes: { event: "sidebar_layout" },
    performedBy: req.user?.id,
  });
  res.json({ layout });
});

/** Puts the sidebar back to the built-in order. */
export const resetSidebarLayoutHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  await req.db!.update(company).set({ sidebarLayout: null });
  await recordAuditTrail(req.db!, {
    entityType: "Company",
    entityId: co.id,
    action: "update",
    changes: { event: "sidebar_layout_reset" },
    performedBy: req.user?.id,
  });
  res.json({ layout: null });
});

type ReleaseNote = { id: string; text: string; createdAt: string; createdByName: string; archivedAt?: string };

/** Current What's New notes. Archived notes stay stored and are not shown as current. */
export const listReleaseNotesHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const notes = (co.releaseNotes ?? []).filter((note) => !note.archivedAt);
  const level = req.user && req.db ? await getUserAccessLevel(req.db, req.user, "management_review") : "none";
  res.json({
    notes,
    canEdit: level === "edit",
  });
});

export const createReleaseNoteHandler = asyncHandler(async (req: Request, res: Response) => {
  const text = String((req.body as { text?: string }).text ?? "").trim();
  if (!text || text.length > 500) throw AppError.badRequest("Write a short note.");
  const co = await loadCompany(req);
  const [author] = req.user ? await req.db!.select({ name: users.name }).from(users).where(eq(users.id, req.user.id)) : [];
  const note: ReleaseNote = {
    id: randomUUID(),
    text,
    createdAt: new Date().toISOString(),
    createdByName: author?.name?.trim() || "Someone",
  };
  const releaseNotes = [note, ...(co.releaseNotes ?? [])].slice(0, 30);
  await req.db!.update(company).set({ releaseNotes }).where(eq(company.id, co.id));
  await recordAuditTrail(req.db!, {
    entityType: "Company",
    entityId: co.id,
    action: "update",
    changes: { event: "release_note_added", noteId: note.id },
    performedBy: req.user?.id,
  });
  res.status(201).json(note);
});

export const archiveReleaseNoteHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const id = String(req.params.id ?? "");
  const notes = co.releaseNotes ?? [];
  if (!notes.some((note) => note.id === id)) throw AppError.notFound("Note");
  const releaseNotes = notes.map((note) => (note.id === id ? { ...note, archivedAt: new Date().toISOString() } : note));
  await req.db!.update(company).set({ releaseNotes }).where(eq(company.id, co.id));
  await recordAuditTrail(req.db!, {
    entityType: "Company",
    entityId: co.id,
    action: "update",
    changes: { event: "release_note_archived", noteId: id },
    performedBy: req.user?.id,
  });
  res.status(204).send();
});
