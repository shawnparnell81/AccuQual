import { pgTable, serial, text, jsonb, timestamp, boolean, integer, numeric } from "drizzle-orm/pg-core";

/**
 * A tenant is a company/plant/division/customer (see Tenant Onboarding Flow Spec).
 * Every tenant-owned table carries a `tenantId` FK to this table and is
 * RLS-protected (see drizzle/post-migrate/rls-policies.sql) plus explicitly
 * filtered by `tenantId` in every query (see lib/tenantScope.ts) — the two
 * layers are intentionally redundant (defense in depth for a compliance-oriented
 * QMS), not either/or.
 */
export const tenants = pgTable("tenants", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  status: text("status").notNull().default("active"), // active, inactive (soft-deleted)
  // Who must use multi-factor authentication: "optional" (nobody is forced),
  // "admins" (default), or "all" users of the tenant. platform_admin accounts
  // always need it regardless of this value.
  mfaPolicy: text("mfa_policy").notNull().default("admins"),
  /**
   * Theme colors (secondaryColor..borderColor) extend this same object
   * rather than a parallel "theme" jsonb — they're all one tenant-branding
   * config a tenant admin edits together, same reasoning as folding
   * assistantName into aiConfig rather than a new column. All hex strings;
   * the frontend theme engine (apps/web/src/lib/theme.ts) converts each to
   * the HSL triplet globals.css's CSS custom properties expect. A primary
   * color also derives the unset surface tokens (background, card, text,
   * border) for the active light or dark mode; explicit background/text/
   * border fields still win when set, and anything left unset with no
   * primary falls back to the built-in palette.
   */
  branding: jsonb("branding").$type<{
    logoUrl?: string;
    primaryColor?: string;
    pdfHeader?: string;
    pdfFooter?: string;
    secondaryColor?: string;
    accentColor?: string;
    backgroundLight?: string;
    backgroundDark?: string;
    textLight?: string;
    textDark?: string;
    formFieldColor?: string;
    buttonColor?: string;
    borderColor?: string;
  }>().default({}),
  /**
   * Per-tenant AI settings. apiKeyEncrypted is real AES-256-GCM ciphertext
   * (see tenant/crypto.ts) — never plaintext, never returned by any GET.
   * assistantName is the one field with no default meaning in the LLM
   * gateway itself — it only ever labels the floating Assistant UI (see
   * AiAssistantPanel.tsx). As of the AI Assistant module, llm-gateway.ts's
   * callLlm() DOES use provider/apiKeyEncrypted/modelName for real calls
   * when set (see ai.assistant.ts) — falling back to the global env config
   * when a tenant hasn't configured its own, same honest-stub fallback the
   * gateway already had.
   */
  aiConfig: jsonb("ai_config").$type<{
    provider?: "anthropic" | "openai";
    apiKeyEncrypted?: string;
    modelName?: string;
    temperature?: number;
    maxTokens?: number;
    assistantName?: string;
    /** Phase 4 AI guardrails: "standard" runs every pipeline as today; "strict" rejects any output that fails its schema check instead of falling back to a raw/degraded save (see ai.guardrails.ts's classifyOutput). Tenant-configurable, defaults to "standard" when unset. */
    safetyMode?: "standard" | "strict";
  }>(),
  /**
   * BYOK usage/limits — real flat columns, not folded into aiConfig above,
   * because these are counters a concurrent AI call must increment
   * atomically (`SET col = col + $1` is trivially atomic in Postgres; doing
   * the same inside one jsonb blob via a read-modify-write risks a lost
   * update between two simultaneous requests). aiConfig stays "rarely-changed
   * config a human edits"; these are "counters the request path writes on
   * every call". aiUsageTokens/aiUsageCost are all-time cumulative (for the
   * dashboard's "Total tokens/cost" figures) — the *monthly* limit check
   * itself is computed live from real audit_trail rows for the current
   * calendar month (see ai.assistant.ts), not from these two columns, since
   * a single cumulative counter can never really implement "monthly" without
   * a reset mechanism, and this app has no background jobs to reset one.
   */
  aiUsageTokens: integer("ai_usage_tokens").notNull().default(0),
  aiUsageCost: numeric("ai_usage_cost").notNull().default("0"),
  aiMonthlyLimit: integer("ai_monthly_limit"),
  aiLimitEnforced: boolean("ai_limit_enforced").notNull().default(false),
  /**
   * Settings → Feasibility Module integration. Same "rarely-changed config
   * a human edits" reasoning as branding/aiConfig above, not a separate
   * tenant_settings table — see modules/settings/. Read by
   * feasibility.controller.ts on create (defaultRiskLevel seeds all 7 fixed
   * assessment areas, autoAssignOwner) and on finalize (requiredDocuments
   * validation, notificationsEnabled routing) — see that file's own
   * comments for exactly where each field is consumed. customerRequirement
   * Mapping (a per-code lookup) was dropped when Feasibility was rebuilt as
   * a bespoke fixed-structure document — the real form has no per-code
   * customer-requirement field to resolve it against, only a free-text
   * "Special Customer Requirements" field.
   */
  feasibilitySettings: jsonb("feasibility_settings").$type<{
    defaultRiskLevel?: "low" | "medium" | "high";
    autoAssignOwner?: boolean;
    requiredDocuments?: string[];
    notificationsEnabled?: boolean;
  }>().default({}),
  /**
   * Settings → Inventory Module expansion. Read by inventory.service.ts
   * (lot/serial auto-generation on receive/produce movements, reservation
   * rules on reserve/release, aging buckets on list/get) and
   * inventory.costing.ts (cost rounding) — see each file's own comments.
   */
  inventorySettings: jsonb("inventory_settings").$type<{
    agingRules?: { warningDays?: number; criticalDays?: number };
    reservationRules?: { allowNegativeAllocation?: boolean; autoReleaseAfterDays?: number };
    autoGenerateLotNumbers?: boolean;
    lotNumberFormat?: string; // tokens: {SKU} {YYYY} {MM} {DD} {SEQ} — see inventory.service.ts's generateTrackingNumber
    autoGenerateSerialNumbers?: boolean;
    serialNumberFormat?: string; // same tokens as lotNumberFormat
    costAdjustmentRules?: { method?: "average" | "latest"; roundingPrecision?: number };
    auditFrequency?: "daily" | "weekly" | "monthly" | "quarterly"; // drives cycleCountDue on list/get — see inventory.controller.ts
  }>().default({}),
  /**
   * Settings → ERP Sync Engine. webhookSecretEncrypted is real AES-256-GCM
   * ciphertext via the same tenant/crypto.ts helpers aiConfig.apiKeyEncrypted
   * uses — never plaintext, never returned by any GET. statusHistory is
   * capped at 20 entries by settings.erpSync.ts (a human-edited config blob
   * that also accumulates a short run log, not an unbounded ledger — see
   * that file's own comment). There is no background scheduler in this app
   * (same honest limitation aiUsageTokens's own comment already documents
   * for monthly-limit resets) — `schedule` is real stored config a future
   * worker could read, but today a sync only ever actually runs when
   * POST /settings/erp-sync/trigger is called.
   */
  erpSyncSettings: jsonb("erp_sync_settings").$type<{
    schedule?: "manual" | "hourly" | "daily";
    direction?: "push" | "pull" | "bidirectional";
    modulesEnabled?: string[]; // inventory | suppliers | purchaseOrders | workOrders
    conflictRules?: { resolutionStrategy?: "local_wins" | "remote_wins" | "manual_review" };
    retryPolicy?: { maxRetries?: number; backoffSeconds?: number };
    webhookUrl?: string;
    webhookSecretEncrypted?: string;
    statusHistory?: { at: string; status: "success" | "failed" | "skipped"; modules: string[]; message?: string }[];
  }>().default({}),
  /**
   * Settings → Supplier Risk (Phase 7). Weights for the deterministic
   * Supplier Quality Risk Score's 7 factors — see
   * modules/supplier/supplier.qualityRisk.ts, which reads this (falling
   * back to DEFAULT_SUPPLIER_RISK_WEIGHTS when unset) every time a score is
   * recomputed. Same "rarely-changed config a human edits" jsonb-on-tenants
   * precedent as feasibilitySettings/inventorySettings/erpSyncSettings
   * above — deliberately NOT placed on PlatformAdminPage (that page is
   * platform_admin/cross-tenant tenant-provisioning only and holds no
   * per-tenant module config anywhere today); this follows the Settings
   * page's own established home for exactly this kind of tenant-scoped,
   * module-specific configuration instead.
   */
  supplierRiskWeights: jsonb("supplier_risk_weights").$type<{
    ncr?: number;
    capa?: number;
    capaRecurrence?: number;
    delivery?: number;
    defectRate?: number;
    warranty?: number;
    responsiveness?: number;
  }>().default({}),
  /**
   * Settings → Receiving (Phase 8). Read by erp/receivingAutomation.ts
   * every time a receiving line item's disposition moves to rejected or
   * quarantined — see that file's own comment for exactly how each field
   * is used. `autoCreateNcrDefectCategories`: when non-empty, an NCR is
   * only auto-created if the inspection report's defectCategory is in this
   * list (in addition to the reject/quarantine toggles above being on);
   * empty/unset means "any defect category qualifies."
   */
  receivingSettings: jsonb("receiving_settings").$type<{
    autoCreateNcrOnRejection?: boolean;
    autoCreateNcrOnQuarantine?: boolean;
    autoCreateNcrDefectCategories?: string[];
    capaEscalationThreshold?: number;
    capaEscalationWindowDays?: number;
  }>().default({}),
  /**
   * Phase 10 Admin Console — Tenant Settings. `name` and `branding.logoUrl`
   * already exist as their own column/field (see above) and are reused as-is
   * rather than duplicated here; this only adds the two things the schema
   * genuinely had no home for at all: timezone and a human contact. Same
   * "rarely-changed config a human edits" jsonb-on-tenants precedent as
   * every other settings blob on this table — see tenant.controller.ts's
   * getProfileHandler/updateProfileHandler for the one endpoint that reads
   * name+branding.logoUrl+this together as a single "tenant profile".
   */
  profile: jsonb("profile").$type<{
    timezone?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
  }>().default({}),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
