// Mirrors services/api/src/modules/feasibility/feasibility.validation.ts exactly.
// "future_product" deliberately excluded from SOURCE_TYPES here — it never
// gets a real "Create Feasibility Review" button since Product onboarding
// doesn't exist yet. "customer" is real (Customer Onboarding module).
export const FEASIBILITY_SOURCE_TYPES = ["ncr", "supplier", "complaint", "ppap", "change_request", "work_order", "requisition", "po", "rma", "customer"] as const;
export const FEASIBILITY_STATUSES = ["draft", "submitted", "under_review", "approved", "rejected"] as const;
export const FEASIBILITY_DECISIONS = ["feasible", "conditional", "not_feasible"] as const;

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

/** Mirrors feasibility.controller.ts's own FEASIBLE_MIN/CONDITIONAL_MIN exactly — for client-side decision preview only; the server always computes the real value. */
export const FEASIBLE_MIN = 3.5;
export const CONDITIONAL_MIN = 2.5;

export function decisionFromScore(score: number): "feasible" | "conditional" | "not_feasible" {
  if (score >= FEASIBLE_MIN) return "feasible";
  if (score >= CONDITIONAL_MIN) return "conditional";
  return "not_feasible";
}
