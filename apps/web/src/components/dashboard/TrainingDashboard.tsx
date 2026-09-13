import { useMemo } from "react";
import { WorkflowMetricCard } from "./WorkflowMetricCard";
import { WorkflowTrendChart } from "../charts/WorkflowTrendChart";
import { bucketByMonth, isTrainingOverdue } from "../../lib/workflowMetrics";
import type { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";

/**
 * Training dashboard widgets. "Expired" and "awaiting approval" from the
 * brief are both omitted — neither exists in the real schema (no
 * recertification interval, no approval step; see the Outputs/Rules
 * Dictionaries), so there's nothing to compute either from, even
 * client-side. "Overdue" IS computable (dueAt is real) even though nothing
 * server-side ever marks it — see lib/workflowMetrics.ts.
 *
 * Fetched via one request per course, not per assignment (see
 * useWorkflowDashboardData) — bounded by how many distinct courses exist,
 * not by headcount.
 */
export function TrainingDashboard({ data }: { data: ReturnType<typeof useWorkflowDashboardData> }) {
  const { assignments, assignmentsLoaded, courses } = data;

  const pending = assignments.filter((a) => a.status === "assigned").length;
  const overdue = assignments.filter((a) => isTrainingOverdue(a.dueAt, a.status)).length;
  const completionTrend = useMemo(() => bucketByMonth(assignments.map((a) => a.completedAt)), [assignments]);

  if (!assignmentsLoaded) {
    return <p className="text-sm text-muted-foreground">Loading training assignments across {courses.length} course(s)…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <WorkflowMetricCard label="Courses" value={courses.length} to="/training" />
        <WorkflowMetricCard label="Assignments pending" value={pending} bucket={pending > 0 ? "info" : "muted"} to="/training" />
        <WorkflowMetricCard label="Overdue" value={overdue} bucket={overdue > 0 ? "destructive" : "success"} to="/training" />
        <WorkflowMetricCard label="Total assignments" value={assignments.length} to="/training" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Completions by Month</h3>
        <WorkflowTrendChart data={completionTrend} color="hsl(var(--success))" />
      </div>
    </div>
  );
}
