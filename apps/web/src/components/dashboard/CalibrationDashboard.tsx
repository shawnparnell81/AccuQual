import { useMemo } from "react";
import { WorkflowMetricCard } from "./WorkflowMetricCard";
import { WorkflowTrendChart } from "../charts/WorkflowTrendChart";
import type { MonthBucket } from "../../lib/workflowMetrics";
import type { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";

/**
 * Calibration dashboard widgets. "Awaiting certificate upload" from the
 * brief is deliberately omitted — the equipment list endpoint (listWithStatus)
 * only resolves nextDueAt, not each equipment's latest certificatePath;
 * getting that would mean one extra request per piece of equipment on every
 * dashboard load, an N+1 fan-out this pass chose not to add (see the Audit/
 * Training/CAPA widgets below for where a bounded version of that trade-off
 * was judged worth it instead). "Awaiting approval" is also omitted —
 * Calibration has no approval step in the real schema (see the Rules/
 * Outputs Dictionaries).
 */
export function CalibrationDashboard({ data }: { data: ReturnType<typeof useWorkflowDashboardData> }) {
  const { equipment, now } = data;

  const dueThisMonth = equipment.filter((e) => {
    if (!e.nextDueAt) return false;
    const d = new Date(e.nextDueAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d >= now;
  }).length;
  const overdue = equipment.filter((e) => e.nextDueAt && new Date(e.nextDueAt) < now).length;

  // Forward-looking: how many pieces of equipment come due in each of the next 6 months —
  // a planning view, not a historical trend (there's nothing to look back on for a due date,
  // so this doesn't reuse bucketByMonth, which buckets the past).
  const dueTrend = useMemo((): MonthBucket[] => {
    const buckets: MonthBucket[] = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
      return { key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), count: 0 };
    });
    const byKey = new Map(buckets.map((b) => [b.key, b]));
    for (const e of equipment) {
      if (!e.nextDueAt) continue;
      const d = new Date(e.nextDueAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const bucket = byKey.get(key);
      if (bucket) bucket.count += 1;
    }
    return buckets;
  }, [equipment, now]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        <WorkflowMetricCard label="Equipment tracked" value={equipment.length} to="/calibration" />
        <WorkflowMetricCard label="Due this month" value={dueThisMonth} bucket={dueThisMonth > 0 ? "warning" : "muted"} to="/calibration" />
        <WorkflowMetricCard label="Overdue" value={overdue} bucket={overdue > 0 ? "destructive" : "success"} to="/calibration" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Upcoming Due Dates (next 6 months)</h3>
        <WorkflowTrendChart data={dueTrend} color="hsl(var(--info))" />
      </div>
    </div>
  );
}
