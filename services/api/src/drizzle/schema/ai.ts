import { pgTable, serial, text, integer, timestamp, jsonb, numeric, vector } from "drizzle-orm/pg-core";
import { users } from "./users.js";

export const aiSuggestions = pgTable("ai_suggestions", {
  id: serial("id").primaryKey(),
  module: text("module"), // ncr, capa, 8d, audit, document, supplier, warranty, erp, analysis
  pipeline: text("pipeline"), // root_cause, capa_generator, eight_d_generator, risk_scoring, audit_prep, doc_summary, predictive_quality, ncr_triage, supplier_message_draft, warranty_triage, erp_automation, pr_justification, risk_analysis
  input: jsonb("input").$type<Record<string, unknown>>(),
  output: jsonb("output").$type<Record<string, unknown>>(),
  confidence: numeric("confidence"),
  // Phase 4 AI guardrails: every pipeline attempt gets one row now, success
  // or not — "ok" (real, schema-valid provider response), "stub" (no key
  // configured, deterministic dev stub — never a real result), "malformed"
  // (a real provider response that failed this pipeline's own output-shape
  // check, so it was NOT written into any real record field), "error" (the
  // provider call itself failed after retries). Previously a failed call
  // just threw past asyncHandler with no row at all — no attempt/failure
  // telemetry existed anywhere.
  status: text("status").notNull().default("ok"),
  errorMessage: text("error_message"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const aiRiskScores = pgTable("ai_risk_scores", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type"), // supplier, process, product, ncr
  entityId: integer("entity_id"),
  score: numeric("score"), // 0-100
  details: jsonb("details").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("ok"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * pgvector embeddings for semantic search / retrieval across quality records.
 * Requires the `vector` extension: CREATE EXTENSION IF NOT EXISTS vector;
 */
export const aiEmbeddings = pgTable("ai_embeddings", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(), // ncr, capa, audit_finding, supplier_issue, training_material, document
  entityId: integer("entity_id").notNull(),
  content: text("content").notNull(),
  embedding: vector("embedding", { dimensions: 1536 }),
  createdAt: timestamp("created_at").defaultNow(),
});

export type AiSuggestion = typeof aiSuggestions.$inferSelect;
export type AiRiskScore = typeof aiRiskScores.$inferSelect;
export type AiEmbedding = typeof aiEmbeddings.$inferSelect;
