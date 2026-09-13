import { useMemo } from "react";
import { WorkflowMetricCard } from "./WorkflowMetricCard";
import { WorkflowStateDistributionChart, type StateDatum } from "../charts/WorkflowStateDistributionChart";
import { isAuditOverdue } from "../../lib/workflowMetrics";
import type { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";

/**
 * Audit dashboard widgets. "Awaiting approval" and "audit score trend" are
 * both omitted — Audit has no approval step and no score/passFail field
 * anywhere in the schema (flagged repeatedly across the States, Outputs,
 * and Audit Trail Dictionaries — not re-litigated here). Findings severity
 * IS real and shown instead, fetched one request per audit (bounded by
 * audit count, not finding count — see useWorkflowDashboardData).
 */
export function AuditDashboard({ data }: { data: ReturnType<typeof useWorkflowDashboardData> }) {
  const { audits, auditItems } = data;

  const scheduled = audits.filter((a) => a.status === "scheduled").length;
  const inProgress = audits.filter((a) => a.status === "in_progress").length;
  const overdue = audits.filter((a) => isAuditOverdue(a.scheduledAt, a.status)).length;

  const severityData = useMemo((): StateDatum[] => {
    const counts: Record<string, number> = { observation: 0, minor: 0, major: 0, critical: 0 };
    for (const item of auditItems) if (item.severity) counts[item.severity] = (counts[item.severity] ?? 0) + 1;
    return Object.entries(counts).map(([status, count]) => ({ status, count }));
  }, [auditItems]);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <WorkflowMetricCard label="Scheduled" value={scheduled} to="/audits" />
        <WorkflowMetricCard label="In progress" value={inProgress} bucket="info" to="/audits" />
        <WorkflowMetricCard label="Overdue" value={overdue} bucket={overdue > 0 ? "destructive" : "success"} to="/audits" />
        <WorkflowMetricCard label="Findings logged" value={auditItems.length} to="/audits" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Findings by Severity</h3>
        <WorkflowStateDistributionChart data={severityData} />
      </div>
    </div>
  );
}
