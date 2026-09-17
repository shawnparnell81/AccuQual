import { pgTable, serial, text, integer, timestamp, numeric, jsonb, date, unique } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { suppliers } from "./supplier.js";
import { users } from "./users.js";

/**
 * Phase 7 — the new deterministic, multi-factor "Supplier Quality Risk
 * Score" (weighted formula over NCR/CAPA/RMA/warranty/delivery/
 * responsiveness data — see supplier.qualityRisk.ts). Deliberately a
 * separate concept from three other "risk" things that already exist in
 * this codebase (see that file's own comment): `suppliers.riskLevel` (a
 * manual free-text field nobody writes to programmatically),
 * `ai_risk_scores` (the LLM-based 0-100 scorer behind POST /ai/risk-score,
 * guardrailed/non-deterministic), and `risk_assessments`/FMEA (the manual
 * Risk Register workflow). Naming this table/concept distinctly avoids
 * colluding any of those three, or supplier.performance.ts's own
 * already-informally-"v1"-labeled delivery-only heuristic, which this
 * score also folds in as one of its several factors.
 *
 * One row per supplier per calendar date — POST /suppliers/:id/risk-score
 * /recompute upserts today's row (by supplierId+scoreDate) rather than
 * inserting unboundedly, so GET's trend query returns a real day-by-day
 * history without duplicate same-day rows crowding it out.
 */
export const supplierQualityRiskScores = pgTable(
  "supplier_quality_risk_scores",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
    supplierId: integer("supplier_id").references(() => suppliers.id).notNull(),
    scoreDate: date("score_date").notNull(),
    score: numeric("score").notNull(), // 0-100, higher = riskier
    band: text("band").notNull(), // low | medium | high | critical
    formulaVersion: text("formula_version").notNull().default("v1"),
    breakdown: jsonb("breakdown").$type<{
      ncrFactor: number;
      capaFactor: number;
      capaRecurrenceFactor: number;
      deliveryFactor: number;
      defectRateFactor: number;
      warrantyFactor: number;
      responsivenessFactor: number;
      raw: Record<string, number | null>;
    }>().notNull(),
    computedByUserId: integer("computed_by_user_id").references(() => users.id),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [unique("supplier_quality_risk_scores_supplier_date_unique").on(table.supplierId, table.scoreDate)]
);

export type SupplierQualityRiskScore = typeof supplierQualityRiskScores.$inferSelect;
