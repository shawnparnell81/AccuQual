import { useMemo } from "react";
import { createResourceHooks } from "../../api/resourceHooks";
import type { Ncr, Capa, Audit, Supplier } from "../../api/types";
import { SeverityChart } from "../../components/charts/SeverityChart";
import { CapaEffectivenessChart } from "../../components/charts/CapaEffectivenessChart";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowDashboard } from "../../components/dashboard/WorkflowDashboard";

const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");
const auditHooks = createResourceHooks<Audit>("audits");
const supplierHooks = createResourceHooks<Supplier>("suppliers");

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

/** Dashboard: NCR severity chart, CAPA status overview, audit calendar widget, supplier scorecards, AI insights panel. */
export function DashboardPage() {
  const { data: ncrs = [] } = ncrHooks.useList();
  const { data: capas = [] } = capaHooks.useList();
  const { data: audits = [] } = auditHooks.useList();
  const { data: suppliers = [] } = supplierHooks.useList();

  const severityData = useMemo(() => {
    const counts: Record<string, number> = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const n of ncrs) if (n.severity) counts[n.severity] = (counts[n.severity] ?? 0) + 1;
    return Object.entries(counts).map(([severity, count]) => ({ severity, count }));
  }, [ncrs]);

  const openCapas = capas.filter((c) => c.status !== "closed").length;
  const upcomingAudits = audits.filter((a) => a.status === "scheduled").slice(0, 5);
  const atRiskSuppliers = suppliers.filter((s) => s.riskLevel && s.riskLevel !== "low").slice(0, 5);

  const capaStatusData = useMemo(() => {
    const counts: Record<string, number> = { open: 0, in_progress: 0, verifying: 0, closed: 0 };
    for (const c of capas) if (c.status) counts[c.status] = (counts[c.status] ?? 0) + 1;
    return Object.entries(counts).map(([status, count]) => ({ status, count }));
  }, [capas]);
  const capaEffectivenessRate = capas.length === 0 ? null : Math.round((capas.filter((c) => c.status === "closed").length / capas.length) * 100);

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Dashboard</h1>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <StatCard label="Open NCRs" value={ncrs.filter((n) => n.status !== "closed").length} />
        <StatCard label="Open CAPAs" value={openCapas} />
        <StatCard label="Scheduled Audits" value={audits.filter((a) => a.status === "scheduled").length} />
        <StatCard label="At-Risk Suppliers" value={atRiskSuppliers.length} />
        <StatCard label="CAPA Effectiveness" value={capaEffectivenessRate === null ? "—" : `${capaEffectivenessRate}%`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">NCR Severity</h2>
          <SeverityChart data={severityData} />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Audit Calendar</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {upcomingAudits.length === 0 && <li className="text-muted-foreground">No upcoming audits</li>}
            {upcomingAudits.map((a) => (
              <li key={a.id} className="flex items-center justify-between border-b border-border pb-1">
                <span>{a.name}</span>
                <span className="text-muted-foreground">{a.scheduledAt ? new Date(a.scheduledAt).toLocaleDateString() : "—"}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Supplier Scorecards — Risk Watch</h2>
          <ul className="flex flex-col gap-2 text-sm">
            {atRiskSuppliers.length === 0 && <li className="text-muted-foreground">No at-risk suppliers</li>}
            {atRiskSuppliers.map((s) => (
              <li key={s.id} className="flex items-center justify-between border-b border-border pb-1">
                <span>{s.name}</span>
                <StatusBadge value={s.riskLevel} />
              </li>
            ))}
          </ul>
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">Corrective Action Effectiveness</h2>
          <CapaEffectivenessChart data={capaStatusData} />
        </div>

        <div className="rounded-lg border border-border bg-card p-4">
          <h2 className="mb-2 text-sm font-medium">AI Insights</h2>
          <p className="text-sm text-muted-foreground">
            Predicted high-risk NCRs, suggested CAPA improvements, and process drift alerts appear here — see the{" "}
            <a href="/ai" className="text-primary">
              AI Insights
            </a>{" "}
            page for the full panel.
          </p>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold">Workflow Overview</h2>
        <WorkflowDashboard />
      </div>
    </div>
  );
}
