import { pgTable, serial, text, jsonb, timestamp, boolean } from "drizzle-orm/pg-core";

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
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
