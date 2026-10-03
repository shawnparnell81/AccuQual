import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { WorkflowMetricCard } from "./WorkflowMetricCard";
import { WorkflowTrendChart } from "../charts/WorkflowTrendChart";
import { WorkflowStateDistributionChart } from "../charts/WorkflowStateDistributionChart";
import { bucketByMonth } from "../../lib/workflowMetrics";
import { FRM_NCR_PATH } from "../../lib/qualityEntry";
import { apiClient } from "../../api/client";
import type { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";

interface NcrProcessMetrics {
  openCount: number;
  overdueCount: number;
  criticalCount: number;
  customerCount: number;
  supplierCount: number;
  repeatCount: number;
  averageDaysOpen: number | null;
  averageDaysInStage: number | null;
  averageRcaDays: number | null;
  averageCorrectiveActionDays: number | null;
  averageVerificationDays: number | null;
  averageCycleDays: number | null;
  slaCompliancePercent: number | null;
  closureTrend: { label: string; count: number }[];
  byDepartment: { label: string; count: number }[];
  byRootCause: { label: string; count: number }[];
}

/**
 * NCR/CAPA dashboard widgets. "CAPAs planned vs. implemented"
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
  const contain = ncrs.filter((n) => n.status === "contain" || n.status === "contained").length;
  const disposition = ncrs.filter((n) => n.status === "disposition" || n.status === "investigating").length;
  const capaVerifying = capas.filter((c) => c.status === "verifying").length;

  const closureTrend = useMemo(() => bucketByMonth([...ncrs.map((n) => n.closedAt), ...capas.map((c) => c.closedAt)]), [ncrs, capas]);
  const processMetrics = useQuery({
    queryKey: ["ncr", "process-metrics"],
    queryFn: async () => (await apiClient.get<NcrProcessMetrics>("/ncr/process-metrics")).data,
  });
  const metrics = processMetrics.data;
  const show = (value: number | null | undefined, suffix = "") => (value == null ? "—" : `${value}${suffix}`);

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <WorkflowMetricCard label="NCRs open" value={open} bucket={open > 0 ? "warning" : "success"} to={FRM_NCR_PATH} />
        <WorkflowMetricCard label="Contain" value={contain} bucket="info" to={FRM_NCR_PATH} />
        <WorkflowMetricCard label="Disposition" value={disposition} bucket="info" to={FRM_NCR_PATH} />
        <WorkflowMetricCard label="CAPAs awaiting verification" value={capaVerifying} bucket={capaVerifying > 0 ? "warning" : "muted"} to="/capa" />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">NCR + CAPA Closures by Month</h3>
        <WorkflowTrendChart data={closureTrend} color="hsl(var(--success))" />
      </div>
      {metrics && (
        <div className="flex flex-col gap-4">
          <h3 className="text-sm font-medium">NCR process</h3>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <WorkflowMetricCard label="Open NCRs" value={metrics.openCount} bucket={metrics.openCount > 0 ? "warning" : "success"} to={FRM_NCR_PATH} />
            <WorkflowMetricCard label="Overdue NCRs" value={metrics.overdueCount} bucket={metrics.overdueCount > 0 ? "destructive" : "success"} to={FRM_NCR_PATH} />
            <WorkflowMetricCard label="Critical NCRs" value={metrics.criticalCount} bucket={metrics.criticalCount > 0 ? "destructive" : "muted"} to={FRM_NCR_PATH} />
            <WorkflowMetricCard label="SLA compliance rate" value={show(metrics.slaCompliancePercent, "%")} bucket={metrics.slaCompliancePercent != null && metrics.slaCompliancePercent < 80 ? "warning" : "success"} />
            <WorkflowMetricCard label="Customer NCRs" value={metrics.customerCount} />
            <WorkflowMetricCard label="Supplier NCRs" value={metrics.supplierCount} />
            <WorkflowMetricCard label="Repeat NCRs" value={metrics.repeatCount} bucket={metrics.repeatCount > 0 ? "warning" : "muted"} />
            <WorkflowMetricCard label="Average days to close" value={show(metrics.averageCycleDays)} />
            <WorkflowMetricCard label="Days open" value={show(metrics.averageDaysOpen)} />
            <WorkflowMetricCard label="Days in current stage" value={show(metrics.averageDaysInStage)} />
            <WorkflowMetricCard label="RCA completion time" value={show(metrics.averageRcaDays)} />
            <WorkflowMetricCard label="Corrective action completion time" value={show(metrics.averageCorrectiveActionDays)} />
            <WorkflowMetricCard label="Verification completion time" value={show(metrics.averageVerificationDays)} />
            <WorkflowMetricCard label="Total cycle time" value={show(metrics.averageCycleDays)} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-2 text-sm font-medium">NCRs by department</h3>
              <WorkflowStateDistributionChart data={metrics.byDepartment.map((item) => ({ status: item.label, count: item.count }))} />
            </div>
            <div className="rounded-lg border border-border bg-card p-4">
              <h3 className="mb-2 text-sm font-medium">NCRs by root cause</h3>
              <WorkflowStateDistributionChart data={metrics.byRootCause.map((item) => ({ status: item.label, count: item.count }))} />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Closure trend</h3>
            <WorkflowTrendChart data={metrics.closureTrend.map((item) => ({ key: item.label, label: item.label, count: item.count }))} color="hsl(var(--info))" />
          </div>
        </div>
      )}
    </div>
  );
}
