/**
 * Phase 11 — the six-plus-one semantic colors every dashboard chart file
 * already hand-copied by convention (SeverityChart/CapaEffectivenessChart/
 * InventoryStateChart/MovementTrendsChart/ScrapDistributionChart/
 * SupplierCostChart/ConsumptionVsReceivingChart each defined their own
 * identical hex literals — see InventoryStateChart.tsx's own comment on why
 * they matched: "same semantic weight... rather than a fresh palette per
 * chart"). One shared source of truth so that discipline can't silently
 * drift the next time a chart is added or edited, without collapsing these
 * into StatusBadge's coarser 5-bucket palette — a severity/phase/state chart
 * needs more visual granularity than a generic status pill (e.g. "medium"
 * and "high" severity, or "in_progress" and "verifying" CAPA phases, would
 * otherwise render as the exact same bucket color and lose the distinction
 * the chart exists to show).
 */
export const CHART_COLORS = {
  resolved: "#10b981", // green — healthy / closed / in stock / received
  attention: "#f59e0b", // amber — needs attention / open / below min / consumed / medium severity
  active: "#60a5fa", // blue — action under way / in progress / reorder pending / produced
  waiting: "#a78bfa", // purple — waiting on someone else / verifying / on order / adjusted
  problem: "#fb923c", // orange — still a problem / high severity / overstock
  critical: "#e11d48", // red — critical severity / scrap
  inert: "#94a3b8", // slate — inactive / low severity / transfer (neutral movement)
  fallback: "#64748b",
} as const;
