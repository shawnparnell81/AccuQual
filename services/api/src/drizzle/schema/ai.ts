import { pgTable, serial, text, integer, timestamp, jsonb, numeric, vector } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

export const aiSuggestions = pgTable("ai_suggestions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  module: text("module"), // ncr, capa, 8d, audit, document, supplier
  pipeline: text("pipeline"), // root_cause, capa_generator, eight_d_generator, risk_scoring, audit_prep, doc_summary, predictive_quality
  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  confidence: numeric("confidence"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiRiskScores = pgTable("ai_risk_scores", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  entityType: text("entity_type"), // supplier, process, product, ncr
  entityId: integer("entity_id"),
  score: numeric("score"), // 0-100
  details: jsonb("details").$type<Record<string, unknown>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * pgvector embeddings for semantic search / retrieval across quality records.
 * Requires the `vector` extension: CREATE EXTENSION IF NOT EXISTS vector;
 */
export const aiEmbeddings = pgTable("ai_embeddings", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  entityType: text("entity_type").notNull(), // ncr, capa, audit_finding, supplier_issue, training_material, document
  entityId: integer("entity_id").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type AiRiskScore = typeof aiRiskScores.$inferSelect;
export type AiEmbedding = typeof aiEmbeddings.$inferSelect;
