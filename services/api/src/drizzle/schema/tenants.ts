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
  branding: jsonb("branding").$type<{ logoUrl?: string; primaryColor?: string; pdfHeader?: string; pdfFooter?: string }>().default({}),
  /**
   * Per-tenant AI settings. apiKeyEncrypted is real AES-256-GCM ciphertext
   * (see tenant/crypto.ts) — never plaintext, never returned by any GET.
   * Storage only: services/api/src/modules/ai/llm-gateway.ts still uses the
   * global env-based provider/key for real calls — wiring live per-tenant
   * credential usage into the AI pipelines is a separate, larger task (see
   * the Tenant AI Configuration review), not something this column implies.
   */
  aiConfig: jsonb("ai_config").$type<{ provider?: "anthropic" | "openai"; apiKeyEncrypted?: string; modelName?: string; temperature?: number; maxTokens?: number }>(),
  isDeleted: boolean("is_deleted").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type NewTenant = typeof tenants.$inferInsert;
