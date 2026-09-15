import { pgTable, serial, text, integer, timestamp, numeric, jsonb, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

/**
 * ONE unified Feasibility Review module, not nine separate ones — see the
 * Feasibility Review module review. `sourceType`/`sourceId` are a
 * deliberately unconstrained polymorphic reference (same precedent as
 * risk_assessments' own sourceType/sourceId and complaints.linkedNcrId) —
 * sourceType spans real tables (ncr/supplier/complaint/ppap/change_request/
 * work_order/requisition/po/rma) that a single FK column can't all target,
 * plus two placeholder values (future_customer/future_product) for modules
 * that don't exist yet — those two never get a real sourceId or a "Create
 * Feasibility Review" button anywhere in the UI; they exist only so this
 * schema doesn't need a breaking change once Customer/Product modules are
 * eventually built.
 */
export const feasibilityReviews = pgTable("feasibility_reviews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  sourceType: text("source_type"), // ncr | supplier | complaint | ppap | change_request | work_order | requisition | po | rma | future_customer | future_product
  sourceId: integer("source_id"),
  title: text("title").notNull(),
  description: text("description"),
  overallScore: numeric("overall_score"), // computed from feasibility_scores — see computeOverallScore()
  decision: text("decision"), // feasible | conditional | not_feasible — see computeDecision()
  status: text("status").notNull().default("draft"), // draft -> submitted -> under_review -> approved | rejected
  department: text("department"),
  ownerId: integer("owner_id").references(() => users.id),
  reviewerId: integer("reviewer_id").references(() => users.id),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  decidedAt: timestamp("decided_at"), // stamped on approve/reject
  /**
   * Settings → Feasibility Module integration (see tenants.feasibilitySettings).
   * riskLevel defaults from the tenant's feasibilitySettings.defaultRiskLevel
   * on create when the caller doesn't supply one, then gets re-derived from
   * the computed decision on every score recalculation ("risk scoring reads
   * settings" — see feasibility.controller.ts's recalcScoring) unless a
   * reviewer has since set it explicitly via updateFeasibilityHandler, in
   * which case that manual value sticks (tracked by riskLevelSetManually).
   */
  riskLevel: text("risk_level"), // low | medium | high | critical
  riskLevelSetManually: boolean("risk_level_set_manually").notNull().default(false),
  // Checklist of document names/types the requester has actually attached or
  // confirmed, checked against tenant settings' requiredDocuments on submit
  // (see the "required document validation" comment in
  // feasibility.controller.ts's submitFeasibilityHandler). Not a real file
  // upload/attachment system — see that same comment for why.
  providedDocuments: jsonb("provided_documents").$type<string[]>().default([]),
  customerRequirement: text("customer_requirement"), // raw code/text the requester supplied, e.g. "AS9100"
  mappedRequirementCategory: text("mapped_requirement_category"), // resolved via tenant settings' customerRequirementMapping — see feasibility.controller.ts
});

/**
 * The generic scores table — one row per scoring dimension, instead of a
 * different wide column set per source type (Prompt 1's ~24-column mostly-
 * null table) or nine separate tables (an earlier Prompt 2 draft). Same
 * pattern as risk_assessments' own fmea_items/risk_mitigations sub-tables.
 * `dimensionKey` is the real reusable set (technicalFeasibility,
 * costImpact, reworkFeasibility, ...) — see feasibility.validation.ts.
 */
export const feasibilityScores = pgTable("feasibility_scores", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  feasibilityId: integer("feasibility_id").references(() => feasibilityReviews.id).notNull(),
  dimensionKey: text("dimension_key").notNull(),
  dimensionLabel: text("dimension_label"),
  dimensionType: text("dimension_type"), // feasibility | impact | risk
  value: numeric("value").notNull(), // 1-5
  weight: numeric("weight"),
  contribution: numeric("contribution"), // value * weight, recomputed alongside the parent's overallScore
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type FeasibilityReview = typeof feasibilityReviews.$inferSelect;
export type FeasibilityScore = typeof feasibilityScores.$inferSelect;
