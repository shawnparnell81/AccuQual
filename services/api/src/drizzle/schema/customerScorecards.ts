import { pgTable, serial, text, integer, numeric, timestamp } from "drizzle-orm/pg-core";
import { customers } from "./customers.js";

/**
 * Manually-entered Customer Scorecard — mirrors supplier.ts's own
 * supplierScorecards table exactly (period + two 0-100 scores + a computed
 * overall + notes), rating OUR performance delivering to this customer
 * rather than a supplier's performance to us.
 *
 * Deliberately does NOT also get an auto-computed "risk score" the way
 * suppliers do (see supplier.qualityRisk.ts's weighted formula): that
 * score's real strength comes from customerId FKs on NCR/CAPA/RMA/
 * Warranty/SCAR. For customers, only warranty_claims/crar/
 * feasibility_reviews actually carry a real customerId FK today —
 * complaints and the customer-return register (rma_log) are still
 * free-text customerName only — so a weighted formula here would silently
 * under-count the two modules a quality manager would expect it to weigh
 * most. customers.controller.ts's scorecard-summary endpoint surfaces
 * those three real counts as honest context instead of a fabricated score.
 */
export const customerScorecards = pgTable("customer_scorecards", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id).notNull(),
  period: text("period"), // e.g. "2026-Q1"
  qualityScore: numeric("quality_score"),
  deliveryScore: numeric("delivery_score"),
  overallScore: numeric("overall_score"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CustomerScorecard = typeof customerScorecards.$inferSelect;
