import { useMemo } from "react";
import { WorkflowMetricCard } from "./WorkflowMetricCard";
import { WorkflowTrendChart } from "../charts/WorkflowTrendChart";
import { bucketByMonth } from "../../lib/workflowMetrics";
import type { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";

/**
 * NCR/CAPA dashboard widgets. "CAPAs planned vs. implemented" from the brief
 * doesn't map onto the real status enum (open/in_progress/verifying/closed
 * — no separate "planned" vs. "implemented" states; see the State
 * Dictionary), so this shows CAPA's real breakdown instead of inventing
 * that distinction — the existing Corrective Action Effectiveness chart on
 * the Overview tab already does this well, this section doesn't duplicate
 * it. "CAPAs overdue" is omitted — capa has no due-date field at all.
 * Closure trend combines both tables' real closedAt columns.
 */
export function NcrCapaDashboard({ data }: { data: ReturnType<typeof useWorkflowDashboardData> }) {
  const { ncrs, capas } = data;

  const open = ncrs.filter((n) => n.status !== "closed").length;
  const contained = ncrs.filter((n) => n.status === "contained").length;
  const investigating = ncrs.filter((n) => n.status === "investigating").length;
  const capaVerifying = capas.filter((c) => c.status === "verifying").length;

  const closureTrend = useMemo(() => bucketByMonth([...ncrs.map((n) => n.closedAt), ...capas.map((c) => c.closedAt)]), [ncrs, capas]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <WorkflowMetricCard label="NCRs open" value={open} bucket={open > 0 ? "warning" : "success"} to="/ncr" />
        <WorkflowMetricCard label="NCRs in containment" value={contained} bucket="info" to="/ncr" />
        <WorkflowMetricCard label="NCRs in investigation" value={investigating} bucket="info" to="/ncr" />
        <WorkflowMetricCard label="CAPAs awaiting verification" value={capaVerifying} bucket={capaVerifying > 0 ? "warning" : "muted"} to="/capa" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">NCR + CAPA Closures by Month</h3>
        <WorkflowTrendChart data={closureTrend} color="hsl(var(--success))" />
      </div>
    </div>
  );
}
