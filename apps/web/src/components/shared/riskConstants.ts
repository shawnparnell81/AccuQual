// Mirrors services/api/src/modules/risk/risk.validation.ts's enums exactly —
// kept in one shared frontend file (not duplicated per-component) since
// CreateRiskButton, RiskPage, and RiskDetailPage all need the same lists.
export const RISK_CATEGORIES = ["supplier", "process", "product", "safety", "regulatory", "other"] as const;
export const RISK_STATUSES = ["open", "mitigation", "monitoring", "closed"] as const;
export const MITIGATION_STATUSES = ["planned", "in_progress", "completed"] as const;

/** Standard 5x5 risk-matrix bands over a 1-25 severity x probability score — mirrors risk.controller.ts's computeRiskLevel exactly, for the dashboard heatmap's own coloring. */
export function riskLevelFromScore(score: number): "low" | "medium" | "high" | "critical" {
  if (score >= 16) return "critical";
  if (score >= 10) return "high";
  if (score >= 5) return "medium";
  return "low";
}
