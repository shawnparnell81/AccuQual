import { z } from "zod";

// "customer" is real (see customers.ts / the Customer Onboarding module) —
// promoted from the earlier placeholder "future_customer" now that a real
// Customer record and a real "Feasibility Review" button on its detail page
// both exist. "future_product" stays a placeholder — Product onboarding
// still doesn't exist — accepted here only so a manual/no-source review can
// still be tagged with intent for when that module ships.
export const FEASIBILITY_SOURCE_TYPES = [
  "ncr",
  "supplier",
  "complaint",
  "ppap",
  "change_request",
  "work_order",
  "requisition",
  "po",
  "rma",
  "customer",
  "future_product",
] as const;

export const FEASIBILITY_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected"] as const;
export const FEASIBILITY_DECISIONS = ["feasible", "conditional", "not_feasible"] as const;
export const FEASIBILITY_RISK_LEVELS = ["low", "medium", "high", "critical"] as const;

/**
 * The real reusable dimensionKey set — representative of every QMS context
 * named in the module spec, stored as rows in feasibility_scores rather than
 * one column per key. Not exhaustive by design (dimensionKey is free text so
 * a genuinely new dimension doesn't need a migration) — this is the starter
 * set the frontend offers by default.
 */
export const FEASIBILITY_DIMENSION_KEYS = [
  "technicalFeasibility",
  "resourceFeasibility",
  "costFeasibility",
  "timingFeasibility",
  "regulatoryFeasibility",
  "customerFit",
  "strategicAlignment",
  "capabilityFeasibility",
  "capacityFeasibility",
  "supplierRiskFeasibility",
  "toolingFeasibility",
  "processImpactFeasibility",
  "materialFeasibility",
  "schedulingFeasibility",
  "reworkFeasibility",
  "scrapFeasibility",
  "returnFeasibility",
  "technicalImpact",
  "processImpact",
  "supplierImpact",
  "costImpact",
  "timingImpact",
] as const;

export const createFeasibilitySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  sourceType: z.enum(FEASIBILITY_SOURCE_TYPES).optional(),
  sourceId: z.coerce.number().int().optional(),
  department: z.string().optional(),
  ownerId: z.coerce.number().int().optional(),
  // Settings → Feasibility Module integration — all optional: omitted means
  // "apply the tenant's configured defaults", see
  // feasibility.controller.ts's createFeasibilityHandler.
  riskLevel: z.enum(FEASIBILITY_RISK_LEVELS).optional(),
  customerRequirement: z.string().max(200).optional(),
});

// Deliberately excludes `status`/`decision` — those only ever change through
// the dedicated transition endpoints below, same reasoning as
// risk.validation.ts's updateRiskSchema.
export const updateFeasibilitySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  department: z.string().optional(),
  ownerId: z.coerce.number().int().nullable().optional(),
  reviewerId: z.coerce.number().int().nullable().optional(),
  aiSuggested: z.boolean().optional(),
  // A reviewer setting this explicitly pins it against recalcScoring's
  // auto-derivation from the computed decision — see riskLevelSetManually
  // on the schema and feasibility.controller.ts's recalcScoring.
  riskLevel: z.enum(FEASIBILITY_RISK_LEVELS).optional(),
  providedDocuments: z.array(z.string().min(1)).optional(),
  customerRequirement: z.string().max(200).nullable().optional(),
});

export const createScoreSchema = z.object({
  dimensionKey: z.string().min(1),
  dimensionLabel: z.string().optional(),
  dimensionType: z.string().optional(),
  value: z.coerce.number().min(1).max(5),
  weight: z.coerce.number().min(0).optional(),
  aiSuggested: z.boolean().optional(),
});

export const updateScoreSchema = z.object({
  value: z.coerce.number().min(1).max(5).optional(),
  weight: z.coerce.number().min(0).nullable().optional(),
  dimensionLabel: z.string().optional(),
});
