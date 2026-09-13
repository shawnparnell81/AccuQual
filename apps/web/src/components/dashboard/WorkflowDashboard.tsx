import { useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useWorkflowDashboardData } from "../../hooks/useWorkflowDashboardData";
import { WorkflowOverdueList } from "./WorkflowOverdueList";
import { WorkflowPendingApprovals } from "./WorkflowPendingApprovals";
import { CalibrationDashboard } from "./CalibrationDashboard";
import { DocumentControlDashboard } from "./DocumentControlDashboard";
import { TrainingDashboard } from "./TrainingDashboard";
import { AuditDashboard } from "./AuditDashboard";
import { NcrCapaDashboard } from "./NcrCapaDashboard";
import { SupplierDashboard } from "./SupplierDashboard";

const TABS = ["Overview", "Calibration", "Documents", "Training", "Audit", "NCR / CAPA", "Suppliers"] as const;
type Tab = (typeof TABS)[number];

/**
 * The one workflow dashboard container — "filtering by module" (the
 * brief's section 1 ask) is this tab bar: each tab is a real module filter,
 * not a separate page (no new nav route was added — see the brief's "do not
 * create nav pages"; this lives inside the existing home Dashboard instead).
 * State/severity filtering happens within a tab (the pending-decisions list
 * has its own module filter; a distribution chart's bars are themselves a
 * breakdown by state). Date-range and user filtering are the two brief asks
 * this pass didn't build — most modules don't expose a consistent "assigned
 * user" the way NCR does, and a real date-range picker across 6 differently-
 * shaped date fields felt like it deserved its own considered pass rather
 * than a shallow one bolted on here.
 */
export function WorkflowDashboard() {
  const [tab, setTab] = useState<Tab>("Overview");
  const data = useWorkflowDashboardData();

  if (data.isError) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
        <span className="flex items-center gap-2">
          <AlertTriangle size={16} /> Unable to load the workflow dashboard.
        </span>
        <button onClick={() => data.refetch()} className="rounded-md border border-destructive/40 px-3 py-1.5 text-xs hover:bg-destructive/10">
          Retry
        </button>
      </div>
    );
  }

  if (data.isLoading) {
    return <p className="text-sm text-muted-foreground">Loading workflow dashboard…</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`whitespace-nowrap px-3 py-2 text-sm ${tab === t ? "border-b-2 border-primary font-medium text-primary" : "text-muted-foreground"}`}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <WorkflowOverdueList items={data.overdue} limit={6} />
          <WorkflowPendingApprovals items={data.pending} />
        </div>
      )}
      {tab === "Calibration" && <CalibrationDashboard data={data} />}
      {tab === "Documents" && <DocumentControlDashboard data={data} />}
      {tab === "Training" && <TrainingDashboard data={data} />}
      {tab === "Audit" && <AuditDashboard data={data} />}
      {tab === "NCR / CAPA" && <NcrCapaDashboard data={data} />}
      {tab === "Suppliers" && <SupplierDashboard data={data} />}
    </div>
  );
}
