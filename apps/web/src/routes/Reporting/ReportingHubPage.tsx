import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { useWorkflowAccessLevel } from "../../hooks/useWorkflowAccess";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { TextField, SelectField } from "../../components/forms/Field";
import { TrendLineChart, type TrendDatum } from "../../components/charts/TrendLineChart";
import { RiskHeatmap } from "../../components/charts/RiskHeatmap";
import { ReportExportButtons } from "../../components/shared/ReportExportButtons";
import { AiStructuredSuggestion } from "../../components/shared/AiStructuredSuggestion";

// ---------------------------------------------------------------------------
// Types — local to this page, matching reporting.service.ts's real response
// shapes exactly (see services/api/src/modules/reporting/reporting.service.ts).
// ---------------------------------------------------------------------------
interface NcrMetrics {
  totalOpen: number;
  totalClosed: number;
  bySeverity: { severity: string; count: number }[];
  byStatus: { status: string; count: number }[];
  byMonth: TrendDatum[];
  avgClosureDays: number | null;
}
interface CapaMetrics {
  total: number;
  closed: number;
  effectivenessRate: number;
  byStatus: { status: string; count: number }[];
  byMonth: TrendDatum[];
  avgClosureDays: number | null;
}
interface SupplierPerformanceReport {
  suppliers: { id: number; name: string; riskScore: string; onTimeAvgDays: number | null; accuracyAvgPercent: number | null }[];
  riskDistribution: { riskScore: string; count: number }[];
}
interface WarrantyTrends {
  total: number;
  byStatus: { status: string; count: number }[];
  byMonth: TrendDatum[];
  totalActualCost: number;
}
interface ReceivingTrends {
  total: number;
  acceptRate: number | null;
  byFinalStatus: { status: string; count: number }[];
  byMonth: TrendDatum[];
  inspectionBacklog: number;
  quarantineCount: number;
  bySupplier: { supplierId: number; supplierName: string; count: number }[];
}
interface InventoryQualityTrends {
  currentBelowMinCount: number;
  scrapByMonth: { month: string; quantity: number }[];
  consumptionByMonth: { month: string; quantity: number }[];
}
interface ReportSchedule {
  id: number;
  reportType: string;
  frequency: "daily" | "weekly" | "monthly";
  recipients: string[];
  enabled: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
  nextRunAt: string;
}
interface AiReportSummary {
  summary: string;
  watchItems: string[];
  trend: "improving" | "worsening" | "stable" | "insufficient_data";
}

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

function SectionHeader({ title, reportKey, aiKind }: { title: string; reportKey?: string; aiKind?: string }) {
  return (
    <div className="flex items-center justify-between">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="flex items-center gap-2">
        {aiKind && (
          <AiStructuredSuggestion<AiReportSummary>
            endpoint="/reporting/summary"
            title="AI Report Summary"
            triggerLabel="AI Summary"
            acceptLabel="Acknowledge"
            buildPayload={() => ({ kind: aiKind })}
            renderPreview={(output) => (
              <div className="flex flex-col gap-2 text-sm">
                <p>
                  Trend: <strong className="capitalize">{output.trend.replace(/_/g, " ")}</strong>
                </p>
                <p className="text-muted-foreground">{output.summary}</p>
                {output.watchItems.length > 0 && (
                  <ul className="list-inside list-disc text-muted-foreground">
                    {output.watchItems.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
                <p className="text-xs text-muted-foreground">A non-authoritative note — not stored on any real record.</p>
              </div>
            )}
          />
        )}
        {reportKey && <ReportExportButtons reportKey={reportKey} />}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quality Overview
// ---------------------------------------------------------------------------
function QualityOverview() {
  const { data: ncr } = useQuery<NcrMetrics>({ queryKey: ["reporting", "ncr-metrics"], queryFn: async () => (await apiClient.get("/reporting/ncr-metrics")).data });
  const { data: capa } = useQuery<CapaMetrics>({ queryKey: ["reporting", "capa-metrics"], queryFn: async () => (await apiClient.get("/reporting/capa-metrics")).data });

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="NCR Metrics" reportKey="ncr-metrics" aiKind="quality_trends" />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Open NCRs" value={ncr?.totalOpen ?? "—"} />
        <StatCard label="Closed NCRs" value={ncr?.totalClosed ?? "—"} />
        <StatCard label="Avg. Closure Time" value={ncr?.avgClosureDays !== null && ncr?.avgClosureDays !== undefined ? `${ncr.avgClosureDays}d` : "—"} />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">NCRs Opened per Month</h3>
        <TrendLineChart data={ncr?.byMonth ?? []} label="NCRs" />
      </div>

      <SectionHeader title="CAPA Metrics" reportKey="capa-metrics" />
      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard label="Total CAPAs" value={capa?.total ?? "—"} />
        <StatCard label="Effectiveness (Closure Rate)" value={capa ? `${capa.effectivenessRate}%` : "—"} />
        <StatCard label="Avg. Closure Time" value={capa?.avgClosureDays !== null && capa?.avgClosureDays !== undefined ? `${capa.avgClosureDays}d` : "—"} />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">CAPAs Opened per Month</h3>
        <TrendLineChart data={capa?.byMonth ?? []} label="CAPAs" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Supplier Overview
// ---------------------------------------------------------------------------
function SupplierOverview() {
  const { data } = useQuery<SupplierPerformanceReport>({ queryKey: ["reporting", "supplier-performance"], queryFn: async () => (await apiClient.get("/reporting/supplier-performance")).data });

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Supplier Risk Distribution" reportKey="supplier-performance" aiKind="supplier_risk_changes" />
      <RiskHeatmap cells={(data?.riskDistribution ?? []).map((d) => ({ label: d.riskScore, value: d.count }))} />
      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Supplier</th>
              <th className="p-3">Risk</th>
              <th className="p-3">Avg Delivery</th>
              <th className="p-3">Accuracy</th>
            </tr>
          </thead>
          <tbody>
            {(data?.suppliers ?? []).map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="p-3">{s.name}</td>
                <td className="p-3">
                  <StatusBadge value={s.riskScore} />
                </td>
                <td className="p-3">{s.onTimeAvgDays !== null ? `${s.onTimeAvgDays}d` : "—"}</td>
                <td className="p-3">{s.accuracyAvgPercent !== null ? `${s.accuracyAvgPercent}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Warranty Overview
// ---------------------------------------------------------------------------
function WarrantyOverview() {
  const { data } = useQuery<WarrantyTrends>({ queryKey: ["reporting", "warranty-trends"], queryFn: async () => (await apiClient.get("/reporting/warranty-trends")).data });

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader title="Warranty / RMA Trends" reportKey="warranty-trends" aiKind="warranty_patterns" />
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Total Claims" value={data?.total ?? "—"} />
        <StatCard label="Total Actual Cost" value={data ? `$${data.totalActualCost.toFixed(2)}` : "—"} />
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Claims per Month</h3>
        <TrendLineChart data={data?.byMonth ?? []} label="Claims" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Production / Receiving Overview
// ---------------------------------------------------------------------------
function ProductionReceivingOverview() {
  const { data } = useQuery<ReceivingTrends>({ queryKey: ["reporting", "receiving-trends"], queryFn: async () => (await apiClient.get("/reporting/receiving-trends")).data });
  // Phase 8 task 9 — previously had a real backend route with no frontend
  // widget at all (see reporting.service.ts's own comment); wired in here.
  const { data: inventoryQuality } = useQuery<InventoryQualityTrends>({
    queryKey: ["reporting", "inventory-quality-trends"],
    queryFn: async () => (await apiClient.get("/reporting/inventory-quality-trends")).data,
  });

  const scrapVsConsumption: (TrendDatum & { scrap: number; consumption: number })[] = (() => {
    const scrapByMonth = new Map((inventoryQuality?.scrapByMonth ?? []).map((s) => [s.month, s.quantity]));
    const consumptionByMonth = new Map((inventoryQuality?.consumptionByMonth ?? []).map((s) => [s.month, s.quantity]));
    const months = [...new Set([...scrapByMonth.keys(), ...consumptionByMonth.keys()])].sort();
    return months.map((month) => ({ month, count: scrapByMonth.get(month) ?? 0, scrap: scrapByMonth.get(month) ?? 0, consumption: consumptionByMonth.get(month) ?? 0 }));
  })();

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-4">
        <SectionHeader title="Receiving Dashboard" reportKey="receiving-trends" aiKind="production_deviations" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total Incoming Inspections" value={data?.total ?? "—"} />
          <StatCard label="Accept Rate" value={data?.acceptRate !== null && data?.acceptRate !== undefined ? `${data.acceptRate}%` : "—"} />
          <StatCard label="Inspection Backlog" value={data?.inspectionBacklog ?? "—"} />
          <StatCard label="Quarantine Count" value={data?.quarantineCount ?? "—"} />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Incoming Inspections per Month</h3>
          <TrendLineChart data={data?.byMonth ?? []} label="Inspections" />
        </div>
        {data && data.bySupplier.length > 0 && (
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-3 text-sm font-medium">Supplier Defect Trends (rejected incoming inspections)</h3>
            <RiskHeatmap cells={data.bySupplier.map((s) => ({ label: s.supplierName, value: s.count }))} />
          </div>
        )}
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeader title="Inventory Dashboard" reportKey="inventory-quality-trends" />
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCard label="Open Below-Min Alerts" value={inventoryQuality?.currentBelowMinCount ?? "—"} />
          <StatCard
            label="Scrap vs. Consumption (latest month)"
            value={scrapVsConsumption.length > 0 ? `${scrapVsConsumption[scrapVsConsumption.length - 1]!.scrap} scrapped / ${scrapVsConsumption[scrapVsConsumption.length - 1]!.consumption} consumed` : "—"}
          />
        </div>
        <div className="rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Scrap &amp; Consumption Trends</h3>
          <TrendLineChart data={scrapVsConsumption.map((d) => ({ month: d.month, count: d.scrap }))} label="Scrap Qty" />
        </div>
        <p className="text-xs text-muted-foreground">
          Real per-lot/serial traceability (receiving → inventory → NCR/CAPA/warranty) is available on each item's own detail page under Inventory, or searched
          company-wide by lot #, serial #, or SKU under Inventory → Lot / Serial Search.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Scheduled Reports & Health — admin only, matches the backend's own
// admin-only gate on /reporting/schedules (see reporting.routes.ts).
// ---------------------------------------------------------------------------
const REPORT_TYPE_OPTIONS = [
  { value: "ncr_summary", label: "NCR Summary" },
  { value: "capa_summary", label: "CAPA Summary" },
  { value: "supplier_scorecard", label: "Supplier Scorecard" },
  { value: "warranty_summary", label: "Warranty / RMA Summary" },
  { value: "receiving_summary", label: "Receiving Inspection Summary" },
];

function ScheduledReportsSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: schedules = [], isLoading } = useQuery<ReportSchedule[]>({ queryKey: ["reporting", "schedules"], queryFn: async () => (await apiClient.get("/reporting/schedules")).data });
  const [form, setForm] = useState({ reportType: "ncr_summary", frequency: "weekly" as "daily" | "weekly" | "monthly", recipients: "" });

  const create = useMutation({
    mutationFn: async () =>
      (
        await apiClient.post("/reporting/schedules", {
          reportType: form.reportType,
          frequency: form.frequency,
          recipients: form.recipients.split(",").map((r) => r.trim()).filter(Boolean),
        })
      ).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["reporting", "schedules"] });
      setForm({ reportType: "ncr_summary", frequency: "weekly", recipients: "" });
      toast.success("Report schedule created.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't create this schedule.")),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => apiClient.delete(`/reporting/schedules/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reporting", "schedules"] }),
  });

  const toggle = useMutation({
    mutationFn: async ({ id, enabled }: { id: number; enabled: boolean }) => apiClient.patch(`/reporting/schedules/${id}`, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["reporting", "schedules"] }),
  });

  const sendNow = useMutation({
    mutationFn: async (id: number) => (await apiClient.post(`/reporting/schedules/${id}/send-now`)).data,
    onSuccess: (data: ReportSchedule) => {
      queryClient.invalidateQueries({ queryKey: ["reporting", "schedules"] });
      toast[data.lastRunStatus === "error" ? "error" : "success"](`Report ${data.lastRunStatus === "error" ? "failed" : data.lastRunStatus}.`);
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't send this report.")),
  });

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">Scheduled Reports</h2>

      <form
        className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          create.mutate();
        }}
      >
        <SelectField label="Report" value={form.reportType} onChange={(e) => setForm({ ...form, reportType: e.target.value })}>
          {REPORT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </SelectField>
        <SelectField label="Frequency" value={form.frequency} onChange={(e) => setForm({ ...form, frequency: e.target.value as typeof form.frequency })}>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly</option>
          <option value="monthly">Monthly</option>
        </SelectField>
        <TextField label="Recipients (comma-separated)" value={form.recipients} onChange={(e) => setForm({ ...form, recipients: e.target.value })} placeholder="quality@company.com, ops@company.com" />
        <button type="submit" disabled={create.isPending || !form.recipients.trim()} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {create.isPending ? "Creating…" : "Create Schedule"}
        </button>
      </form>

      <div className="overflow-x-auto rounded-lg border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="border-b border-border text-left text-xs text-muted-foreground">
            <tr>
              <th className="p-3">Report</th>
              <th className="p-3">Frequency</th>
              <th className="p-3">Recipients</th>
              <th className="p-3">Last Run</th>
              <th className="p-3">Next Run</th>
              <th className="p-3">Enabled</th>
              <th className="p-3">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={7}>
                  Loading…
                </td>
              </tr>
            ) : schedules.length === 0 ? (
              <tr>
                <td className="p-3 text-muted-foreground" colSpan={7}>
                  No scheduled reports yet.
                </td>
              </tr>
            ) : (
              schedules.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="p-3">{REPORT_TYPE_OPTIONS.find((o) => o.value === s.reportType)?.label ?? s.reportType}</td>
                  <td className="p-3 capitalize">{s.frequency}</td>
                  <td className="p-3 text-xs">{s.recipients.join(", ")}</td>
                  <td className="p-3">
                    {s.lastRunAt ? (
                      <>
                        <StatusBadge value={s.lastRunStatus ?? "logged_only"} /> <span className="text-xs text-muted-foreground">{new Date(s.lastRunAt).toLocaleString()}</span>
                        {s.lastError && <p className="mt-1 text-xs text-destructive">{s.lastError}</p>}
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Never run</span>
                    )}
                  </td>
                  <td className="p-3 text-xs">{new Date(s.nextRunAt).toLocaleString()}</td>
                  <td className="p-3">
                    <input type="checkbox" checked={s.enabled} onChange={(e) => toggle.mutate({ id: s.id, enabled: e.target.checked })} className="h-4 w-4 rounded border-form-field" />
                  </td>
                  <td className="p-3">
                    <div className="flex gap-2">
                      <button onClick={() => sendNow.mutate(s.id)} disabled={sendNow.isPending} className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50">
                        Send Now
                      </button>
                      <button onClick={() => remove.mutate(s.id)} className="rounded-md border border-border px-2 py-1 text-xs text-destructive hover:bg-destructive/10">
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page — tab visibility mirrors backend RBAC exactly (same ResourceKey
// each tab's own data is gated by), per Phase 6 task 5's "permission-based
// visibility for dashboards".
// ---------------------------------------------------------------------------
const TABS = [
  { key: "quality", label: "Quality Overview", navKey: "ncr" },
  { key: "supplier", label: "Supplier Overview", navKey: "suppliers" },
  { key: "warranty", label: "Warranty Overview", navKey: "warranty" },
  { key: "production", label: "Production / Receiving", navKey: "inventory" },
] as const;

export function ReportingHubPage() {
  const user = useCurrentUser();
  const isAdmin = user?.roleName === "admin";
  const ncrAccess = useWorkflowAccessLevel("ncr");
  const supplierAccess = useWorkflowAccessLevel("suppliers");
  const warrantyAccess = useWorkflowAccessLevel("warranty");
  const inventoryAccess = useWorkflowAccessLevel("inventory");
  const accessByKey: Record<string, string> = { ncr: ncrAccess, suppliers: supplierAccess, warranty: warrantyAccess, inventory: inventoryAccess };

  const visibleTabs = TABS.filter((t) => accessByKey[t.navKey] !== "none");
  const [activeTab, setActiveTab] = useState<string>(visibleTabs[0]?.key ?? "quality");
  const [showSchedules, setShowSchedules] = useState(false);

  if (visibleTabs.length === 0 && !isAdmin) {
    return <p className="text-sm text-muted-foreground">You don't have access to any reports yet — ask your admin to grant you read access to a module.</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Reporting & Analytics Hub</h1>
        {isAdmin && (
          <button onClick={() => setShowSchedules((v) => !v)} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            {showSchedules ? "View Dashboards" : "Manage Scheduled Reports"}
          </button>
        )}
      </div>

      {showSchedules ? (
        <ScheduledReportsSection />
      ) : (
        <>
          <div className="flex gap-2 border-b border-border">
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                onClick={() => setActiveTab(t.key)}
                className={`border-b-2 px-3 py-2 text-sm font-medium ${activeTab === t.key ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"}`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {activeTab === "quality" && accessByKey.ncr !== "none" && <QualityOverview />}
          {activeTab === "supplier" && accessByKey.suppliers !== "none" && <SupplierOverview />}
          {activeTab === "warranty" && accessByKey.warranty !== "none" && <WarrantyOverview />}
          {activeTab === "production" && accessByKey.inventory !== "none" && <ProductionReceivingOverview />}
        </>
      )}
    </div>
  );
}
