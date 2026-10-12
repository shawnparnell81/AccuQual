import { integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { sites } from "./sites.js";
import { inspApprovedSources, inspRecords } from "./faiInspection.js";

/**
 * FAI & Inspection module (Phase 2: scheduling). New tables only, same convention as
 * Phase 1's faiInspection.ts — not re-exported from schema/index.ts (Phase 1 wasn't
 * either; the drizzle-kit snapshot has been stale since migration 0077, so every
 * module since then, including this one, ships a hand-written additive migration
 * instead of a drizzle-kit generate).
 */

/**
 * Random-pull rules: one row. `siteId` here is an optional FILTER ("only pick from this
 * plant"), not a tenancy key — the rules themselves apply across the whole module, same
 * as the spec's "optional filters (product family, risk class, plant)" wording.
 */
export const faiRandomPullRules = pgTable("fai_random_pull_rules", {
  id: serial("id").primaryKey(),
  pickMode: text("pick_mode").notNull().default("percent"), // percent | count
  pickPercent: integer("pick_percent"), // 1-100, used when pickMode = percent
  pickCount: integer("pick_count"), // used when pickMode = count
  productFamily: text("product_family"),
  riskClass: text("risk_class"), // Critical | Major | Minor
  siteId: integer("site_id").references(() => sites.id),
  excludeMonths: integer("exclude_months").notNull().default(6),
  updatedBy: integer("updated_by").references(() => users.id),
  updatedAt: timestamp("updated_at"),
});

/** One generated pick list. Once approved, the app never edits rulesSnapshot or removes items — only an item's own linkedRecordId changes as it's worked. */
export const faiRandomPullBatches = pgTable("fai_random_pull_batches", {
  id: serial("id").primaryKey(),
  year: integer("year").notNull(),
  rulesSnapshot: jsonb("rules_snapshot").notNull(),
  status: text("status").notNull().default("pending_approval"), // pending_approval | approved
  generatedBy: integer("generated_by").references(() => users.id),
  generatedAt: timestamp("generated_at").defaultNow(),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  approvalSignature: text("approval_signature"),
});

/** One picked source within a batch. Status (pending / linked / completed) is derived from linkedRecordId + that record's own status, never stored twice. */
export const faiRandomPullItems = pgTable(
  "fai_random_pull_items",
  {
    id: serial("id").primaryKey(),
    batchId: integer("batch_id").notNull().references(() => faiRandomPullBatches.id),
    sourceId: integer("source_id").notNull().references(() => inspApprovedSources.id),
    linkedRecordId: integer("linked_record_id").references(() => inspRecords.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    batchSourceUnique: uniqueIndex("fai_random_pull_items_batch_source_idx").on(table.batchId, table.sourceId),
  }),
);

export type FaiRandomPullRules = typeof faiRandomPullRules.$inferSelect;
export type FaiRandomPullBatch = typeof faiRandomPullBatches.$inferSelect;
export type FaiRandomPullItem = typeof faiRandomPullItems.$inferSelect;
