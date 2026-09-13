import { useMemo } from "react";
import { WorkflowMetricCard } from "./WorkflowMetricCard";
import { WorkflowStateDistributionChart, type StateDatum } from "../charts/WorkflowStateDistributionChart";
import type { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";

/**
 * Supplier dashboard widgets. "Pending approval" from the brief is omitted —
 * confirmed since the State Dictionary that new suppliers start already
 * "active", with no pending-approval gate in the real schema. "Status trend
 * chart" is also omitted: `suppliers` has no updatedAt column at all (only
 * createdAt), so there's no real date to bucket a status change by without
 * fetching every supplier's individual audit trail — an N+1 fan-out that,
 * unlike Training/Audit's bounded course/audit counts, has no natural cap
 * here and was judged not worth adding. A distribution snapshot (real, from
 * the list endpoint) stands in for the requested trend.
 */
export function SupplierDashboard({ data }: { data: ReturnType<typeof useWorkflowDashboardData> }) {
  const { suppliers } = data;

  const conditional = suppliers.filter((s) => s.status === "probation").length;
  const suspended = suppliers.filter((s) => s.status === "suspended").length;

  const statusData = useMemo((): StateDatum[] => {
    const counts: Record<string, number> = { active: 0, probation: 0, suspended: 0, disqualified: 0 };
    for (const s of suppliers) counts[s.status] = (counts[s.status] ?? 0) + 1;
    return Object.entries(counts).map(([status, count]) => ({ status, count }));
  }, [suppliers]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <WorkflowMetricCard label="Total suppliers" value={suppliers.length} to="/suppliers" />
        <WorkflowMetricCard label="Conditional" value={conditional} bucket={conditional > 0 ? "warning" : "muted"} to="/suppliers" />
        <WorkflowMetricCard label="Suspended" value={suspended} bucket={suspended > 0 ? "destructive" : "success"} to="/suppliers" />
        <WorkflowMetricCard label="Disqualified" value={suppliers.filter((s) => s.status === "disqualified").length} bucket="destructive" to="/suppliers" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Supplier Status Distribution</h3>
        <WorkflowStateDistributionChart data={statusData} />
      </div>
    </div>
  );
}
