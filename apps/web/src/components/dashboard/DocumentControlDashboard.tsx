import { useMemo } from "react";
import { WorkflowMetricCard } from "./WorkflowMetricCard";
import { WorkflowTrendChart } from "../charts/WorkflowTrendChart";
import { bucketByMonth } from "../../lib/workflowMetrics";
import type { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";

/**
 * Document Control dashboard widgets. The brief asks for separate "awaiting
 * approval" and "awaiting release" cards — in the real schema those are the
 * same status ("in_review"; see the State Dictionary's Released=approved
 * naming note), so one honest card stands in for both rather than two
 * identical numbers under different names. "Revision trend" uses each
 * document's own `updatedAt` as an activity proxy, not a true per-version
 * count — there's no bulk endpoint for every document's version history,
 * only a per-document one (GET /documents/:id/history), and fanning that
 * out across every document was judged not worth it for a trend chart.
 */
export function DocumentControlDashboard({ data }: { data: ReturnType<typeof useWorkflowDashboardData> }) {
  const { documents } = data;

  const inDraft = documents.filter((d) => d.status === "draft").length;
  const awaitingDecision = documents.filter((d) => d.status === "in_review").length;
  const obsoleteNotArchived = documents.filter((d) => d.status === "obsolete" && d.retentionState !== "archived").length;

  const activityTrend = useMemo(() => bucketByMonth(documents.map((d) => d.updatedAt)), [documents]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <WorkflowMetricCard label="In Draft" value={inDraft} to="/documents" />
        <WorkflowMetricCard label="Awaiting approval / release" value={awaitingDecision} bucket={awaitingDecision > 0 ? "warning" : "muted"} to="/documents" />
        <WorkflowMetricCard label="Obsolete, not archived" value={obsoleteNotArchived} bucket={obsoleteNotArchived > 0 ? "warning" : "success"} to="/documents" />
        <WorkflowMetricCard label="Total controlled documents" value={documents.length} to="/documents" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Document Activity by Month</h3>
        <p className="mb-2 text-xs text-muted-foreground">Documents last touched (revised, approved, or archived) per month — a proxy for revision activity, not an exact revision count.</p>
        <WorkflowTrendChart data={activityTrend} color="hsl(var(--success))" />
      </div>
    </div>
  );
}
