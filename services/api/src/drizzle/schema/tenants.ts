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
  /**
   * Theme colors (secondaryColor..borderColor) extend this same object
   * rather than a parallel "theme" jsonb — they're all one tenant-branding
   * config a tenant admin edits together, same reasoning as folding
   * assistantName into aiConfig rather than a new column. All hex strings;
   * the frontend theme engine (styles/theme.ts) converts each to the HSL
   * triplet globals.css's CSS custom properties expect, then falls back to
   * the built-in palette for anything unset — so a tenant can override just
   * primaryColor and leave the rest on defaults.
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
  aiConfig: jsonb("ai_config").$type<{ provider?: "anthropic" | "openai"; apiKeyEncrypted?: string; modelName?: string; temperature?: number; maxTokens?: number; assistantName?: string }>(),
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
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
