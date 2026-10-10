import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { eq, and, gte, inArray, sql, desc } from "drizzle-orm";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { encryptSecret, maskSecret, tryDecryptSecret } from "./crypto.js";
import { aiConfigAssignment, ignorableApiKey, KEY_UNREADABLE_MESSAGE, keyColumnDrops, keyOnFileSentence } from "./aiConfigKey.js";
import { validateApiKey } from "../ai/llm-gateway.js";
import { aiFeaturesEnabled, aiKeySource } from "../ai/aiFeatures.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { env } from "../../config/env.js";
import { getUserAccessLevel } from "../../middleware/departmentAccess.js";
import { sessionLengthHoursFromProfile } from "../auth/sessionLength.js";

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
  });
});

type AiConfigRow = NonNullable<(typeof company.$inferSelect)["aiConfig"]>;

function noStore(res: Response) {
  res.setHeader("Cache-Control", "private, no-store");
}

/**
 * Never returns the real key. keyStatus is "ready" when this company or the
 * platform default has a usable key, "missing" when neither does, and
 * "unreadable" when ciphertext is stored but this server's encryption key
 * cannot open it. A failed decrypt used to throw, the settings page treated
 * that error as an empty form, and the key looked like it had been deleted.
 */
async function aiConfigView(req: Request, config: AiConfigRow, co: { aiMonthlyLimit: number | null; aiLimitEnforced: boolean }) {
  const stored = config.apiKeyEncrypted;
  let plaintext: string | null = null;
  let keyError: string | null = null;
  if (stored) {
    const decoded = tryDecryptSecret(stored);
    if (decoded.ok) plaintext = decoded.plaintext;
    else keyError = KEY_UNREADABLE_MESSAGE;
  }
  const last4 = plaintext ? plaintext.slice(-4) : null;
  const provenance = last4 ? await keyProvenance(req, config) : { name: null as string | null, at: null as string | null };
  const platformKey = !!(env.ANTHROPIC_API_KEY || env.OPENAI_API_KEY);
  const keyStatus: "ready" | "missing" | "unreadable" = keyError ? "unreadable" : stored || platformKey ? "ready" : "missing";
  const keySource = aiKeySource(config, { anthropic: env.ANTHROPIC_API_KEY, openai: env.OPENAI_API_KEY });
  return {
    provider: config.provider ?? null,
    modelName: config.modelName ?? null,
    temperature: config.temperature ?? null,
    maxTokens: config.maxTokens ?? null,
    assistantName: config.assistantName ?? null,
    safetyMode: config.safetyMode ?? "standard",
    hasApiKey: !!stored,
    maskedApiKey: plaintext ? maskSecret(plaintext) : null,
    keyLast4: last4,
    keySetByName: provenance.name,
    keySetAt: provenance.at,
    keyError,
    keyOnFileLabel: last4 ? keyOnFileSentence(last4, provenance.name, provenance.at ? new Date(provenance.at) : null) : null,
    keyStatus,
    keySource,
    featuresEnabled: aiFeaturesEnabled(config),
    monthlyLimit: co.aiMonthlyLimit,
    limitEnforced: co.aiLimitEnforced,
  };
}

/** Name and time for a key saved before apiKeySetByName existed: the audit row, never the key. */
async function keyProvenance(req: Request, config: AiConfigRow): Promise<{ name: string | null; at: string | null }> {
  if (config.apiKeySetByName && config.apiKeySetAt) return { name: config.apiKeySetByName, at: config.apiKeySetAt };
  const [hit] = await req
    .db!.select({ createdAt: auditTrail.createdAt, performedBy: auditTrail.performedBy })
    .from(auditTrail)
    .where(
      and(
        eq(auditTrail.entityType, "Company"),
        sql`(${auditTrail.changes}->>'action' = 'ai_api_key_set' OR (${auditTrail.changes}->>'action' = 'update_ai_config' AND ${auditTrail.changes}->>'apiKeyChanged' = 'true'))`,
      ),
    )
    .orderBy(desc(auditTrail.id))
    .limit(1);
  if (!hit?.createdAt) return { name: config.apiKeySetByName ?? null, at: config.apiKeySetAt ?? null };
  let name = config.apiKeySetByName ?? null;
  if (!name && hit.performedBy) {
    const [actor] = await req.db!.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, hit.performedBy));
    name = formatUserLabel(actor, hit.performedBy);
  }
  return { name, at: config.apiKeySetAt ?? hit.createdAt.toISOString() };
}

async function actorLabel(req: Request): Promise<string> {
  if (!req.user) return "an administrator";
  const [actor] = await req.db!.select({ name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, req.user.id));
  return formatUserLabel(actor, req.user.id);
}

export const getAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  noStore(res);
  res.json(await aiConfigView(req, co.aiConfig ?? {}, co));
});

export const updateAiConfigHandler = asyncHandler(async (req: Request, res: Response) => {
  const co = await loadCompany(req);
  const { provider, apiKey, removeApiKey, modelName, temperature, maxTokens, assistantName, safetyMode, monthlyLimit, limitEnforced, featuresEnabled } = req.body as {
    provider?: "anthropic" | "openai";
    apiKey?: string;
    removeApiKey?: boolean;
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    assistantName?: string;
    safetyMode?: "standard" | "strict";
    monthlyLimit?: number | null;
    limitEnforced?: boolean;
    featuresEnabled?: boolean;
  };

  const featuresBefore = aiFeaturesEnabled(co.aiConfig);
  // Other fields merge onto the row's current JSON inside the UPDATE. The
  // ciphertext is not copied from this request's earlier SELECT, so a stale
  // read cannot write it away. featuresEnabled belongs in this patch too:
  // replacing the whole object would drop the key. A blank or masked apiKey
  // is not a new key.
  const patch: Record<string, unknown> = {};
  const drop: string[] = [];
  if (provider !== undefined) patch.provider = provider;
  if (modelName !== undefined) patch.modelName = modelName;
  if (temperature !== undefined) patch.temperature = temperature;
  if (maxTokens !== undefined) patch.maxTokens = maxTokens;
  if (safetyMode !== undefined) patch.safetyMode = safetyMode;
  if (featuresEnabled !== undefined) patch.featuresEnabled = featuresEnabled;
  if (assistantName !== undefined) {
    const trimmed = assistantName.trim();
    if (!trimmed) drop.push("assistantName");
    else patch.assistantName = trimmed;
  }

  let keyAction: "set" | "remove" | null = null;
  if (removeApiKey === true) {
    drop.push(...keyColumnDrops());
    keyAction = "remove";
  } else if (!ignorableApiKey(apiKey)) {
    const trimmed = apiKey!.trim();
    const testProvider = provider ?? co.aiConfig?.provider ?? "anthropic";
    const testModel = (typeof modelName === "string" && modelName.trim()) || co.aiConfig?.modelName || env.LLM_MODEL;
    const isValid = await validateApiKey(testProvider, trimmed, testModel);
    if (!isValid) throw AppError.badRequest("Couldn't validate this API key with the provider — check the key, provider, and model, then try again.");
    const savedBy = await actorLabel(req);
    patch.apiKeyEncrypted = encryptSecret(trimmed);
    patch.apiKeySetAt = new Date().toISOString();
    patch.apiKeySetByName = savedBy;
    patch.apiKeySetByUserId = req.user?.id ?? null;
    keyAction = "set";
  }

  const flatPatch: { aiMonthlyLimit?: number | null; aiLimitEnforced?: boolean } = {};
  if (monthlyLimit !== undefined) flatPatch.aiMonthlyLimit = monthlyLimit;
  if (limitEnforced !== undefined) flatPatch.aiLimitEnforced = limitEnforced;

  const writesConfig = Object.keys(patch).length > 0 || drop.length > 0;
  let saved = co;
  if (writesConfig || Object.keys(flatPatch).length > 0) {
    const [updated] = await req.db!.update(company)
      .set({ ...(writesConfig ? { aiConfig: aiConfigAssignment(patch, drop) } : {}), ...flatPatch })
      .where(eq(company.id, co.id))
      .returning();
    saved = updated ?? co;
  }

  const otherFields = Object.keys(req.body).filter((key) => key !== "apiKey" && key !== "removeApiKey");
  if (otherFields.length > 0) {
    await recordAuditTrail(req.db!, {
      entityType: "Company",
      entityId: co.id,
      action: "update",
      changes: {
        action: "update_ai_config",
        fieldsChanged: otherFields,
        provider: saved.aiConfig?.provider,
        modelName: saved.aiConfig?.modelName,
        assistantName: saved.aiConfig?.assistantName,
        monthlyLimit: saved.aiMonthlyLimit,
        limitEnforced: saved.aiLimitEnforced,
        featuresEnabled: { from: featuresBefore, to: aiFeaturesEnabled(saved.aiConfig) },
      },
      performedBy: req.user?.id,
    });
  }
  // The key itself is never written here — not plaintext, not ciphertext.
  if (keyAction) {
    await recordAuditTrail(req.db!, {
      entityType: "Company",
      entityId: co.id,
      action: "update",
      changes: { action: keyAction === "set" ? "ai_api_key_set" : "ai_api_key_removed" },
      performedBy: req.user?.id,
    });
  }

  noStore(res);
  res.json(await aiConfigView(req, saved.aiConfig ?? {}, saved));
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
  res.json({ assistantName: co.aiConfig?.assistantName ?? null, featuresEnabled: aiFeaturesEnabled(co.aiConfig) });
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
