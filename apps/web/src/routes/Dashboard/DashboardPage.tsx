import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { createResourceHooks } from "../../api/resourceHooks";
import type {
  Ncr,
  Capa,
  Audit,
  Supplier,
  InventoryItem,
  InventoryAlert,
  InventoryReorderRequest,
  MovementTrendsResponse,
  ConsumptionVsReceivingResponse,
  ScrapAnalytics,
  ReferenceSummaryEntry,
  SupplierPerformance,
  CostingSummary,
  ErpOverview,
  WorkOrder,
  ErpPurchaseRequisition,
} from "../../api/types";
import { SeverityChart } from "../../components/charts/SeverityChart";
import { CapaEffectivenessChart } from "../../components/charts/CapaEffectivenessChart";
import { InventoryStateChart } from "../../components/charts/InventoryStateChart";
import { MovementTrendsChart } from "../../components/charts/MovementTrendsChart";
import { ConsumptionVsReceivingChart } from "../../components/charts/ConsumptionVsReceivingChart";
import { ScrapDistributionChart } from "../../components/charts/ScrapDistributionChart";
import { SupplierCostChart } from "../../components/charts/SupplierCostChart";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { WorkflowDashboard } from "../../components/dashboard/WorkflowDashboard";
import { RecheckMinMaxButton } from "../../components/dashboard/RecheckMinMaxButton";
import { useCurrentUser } from "../../hooks/useAuth";
import { Palette, FileUp, Bot, Cpu } from "lucide-react";

const ncrHooks = createResourceHooks<Ncr>("ncr");
const capaHooks = createResourceHooks<Capa>("capa");
const auditHooks = createResourceHooks<Audit>("audits");
const supplierHooks = createResourceHooks<Supplier>("suppliers");
const inventoryItemHooks = createResourceHooks<InventoryItem>("inventory/items");
const inventoryAlertHooks = createResourceHooks<InventoryAlert>("inventory/alerts");
const workOrderHooks = createResourceHooks<WorkOrder>("work-orders");
const requisitionHooks = createResourceHooks<ErpPurchaseRequisition>("erp/requisitions");
const reorderRequestHooks = createResourceHooks<InventoryReorderRequest>("inventory/reorder-requests");

const INVENTORY_STATES = ["in_stock", "below_min", "reorder_pending", "on_order", "overstock", "inactive"] as const;

export function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold">{value}</p>
    </div>
  );
}

/** Dashboard: NCR severity chart, CAPA status overview, audit calendar widget, supplier scorecards, AI insights panel. */
export function DashboardPage() {
  const currentUser = useCurrentUser();
  const { data: ncrs = [] } = ncrHooks.useList();
  const { data: capas = [] } = capaHooks.useList();
  const { data: audits = [] } = auditHooks.useList();
  const { data: suppliers = [] } = supplierHooks.useList();
  const { data: inventoryItems = [] } = inventoryItemHooks.useList();
  const { data: inventoryAlerts = [] } = inventoryAlertHooks.useList();
  const { data: reorderRequests = [] } = reorderRequestHooks.useList();
  const pendingReorderRequests = reorderRequests.filter((r) => r.status === "pending").length;
  const { data: movementTrends } = useQuery<MovementTrendsResponse>({
    queryKey: ["inventory/analytics/movements"],
    queryFn: async () => (await apiClient.get("/inventory/analytics/movements", { params: { days: 30 } })).data,
  });
  const { data: consumptionVsReceiving } = useQuery<ConsumptionVsReceivingResponse>({
    queryKey: ["inventory/analytics/consumption-vs-receiving"],
    queryFn: async () => (await apiClient.get("/inventory/analytics/consumption-vs-receiving", { params: { days: 30 } })).data,
  });
  const { data: scrapAnalytics } = useQuery<ScrapAnalytics>({
    queryKey: ["inventory/analytics/scrap"],
    queryFn: async () => (await apiClient.get("/inventory/analytics/scrap")).data,
  });
  const { data: referenceSummary = [] } = useQuery<ReferenceSummaryEntry[]>({
    queryKey: ["inventory/analytics/reference-summary"],
    queryFn: async () => (await apiClient.get("/inventory/analytics/reference-summary")).data,
  });
  const { data: supplierPerformance = [] } = useQuery<SupplierPerformance[]>({
    queryKey: ["suppliers/performance-summary"],
    queryFn: async () => (await apiClient.get("/suppliers/performance-summary")).data,
  });
  const suppliersWithData = supplierPerformance.filter((p) => p.itemCount > 0);
  const suppliersAtRisk = suppliersWithData.filter((p) => p.riskScore === "high").length;
  const timelinessSamples = suppliersWithData.filter((p) => p.deliveryTimeliness.avgDays !== null);
  const avgDeliveryTime =
    timelinessSamples.length === 0 ? null : timelinessSamples.reduce((sum, p) => sum + p.deliveryTimeliness.avgDays!, 0) / timelinessSamples.length;
  const accuracySamples = suppliersWithData.filter((p) => p.deliveryAccuracy.avgPercent !== null);
  const avgDeliveryAccuracy =
    accuracySamples.length === 0 ? null : accuracySamples.reduce((sum, p) => sum + p.deliveryAccuracy.avgPercent!, 0) / accuracySamples.length;
  const { data: costingSummary } = useQuery<CostingSummary>({
    queryKey: ["inventory/costing/summary"],
    queryFn: async () => (await apiClient.get("/inventory/costing/summary", { params: { days: 30 } })).data,
  });
  const openBelowMinAlerts = inventoryAlerts.filter((a) => a.alertType === "below_min" && !a.acknowledgedAt).length;
  const openAlertsTotal = inventoryAlerts.filter((a) => !a.acknowledgedAt).length;
  const acknowledgedAlertsTotal = inventoryAlerts.filter((a) => a.acknowledgedAt).length;
  const { data: erpOverview } = useQuery<ErpOverview>({
    queryKey: ["erp/overview"],
    queryFn: async () => (await apiClient.get("/erp/overview")).data,
  });
  // Same "fetch unconditionally, let a 403 just leave data undefined" pattern
  // as erpOverview/inventoryItems above — a department without access to
  // these two new modules just sees the StatCard fallback to 0.
  const { data: workOrders = [] } = workOrderHooks.useList();
  const { data: requisitions = [] } = requisitionHooks.useList();
  const openWorkOrders = workOrders.filter((wo) => wo.status === "planned" || wo.status === "in_progress").length;
  const requisitionsPendingApproval = requisitions.filter((r) => r.status === "pending_approval").length;

  const inventoryStateData = useMemo(() => {
    const counts: Record<string, number> = Object.fromEntries(INVENTORY_STATES.map((s) => [s, 0]));
    for (const i of inventoryItems) counts[i.state] = (counts[i.state] ?? 0) + 1;
    return INVENTORY_STATES.map((state) => ({ state, count: counts[state] ?? 0 }));
  }, [inventoryItems]);
  const countByState = (state: string) => inventoryItems.filter((i) => i.state === state).length;

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

      <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
        <StatCard label="Open NCRs" value={ncrs.filter((n) => n.status !== "closed").length} />
        <StatCard label="Open CAPAs" value={openCapas} />
        <StatCard label="Scheduled Audits" value={audits.filter((a) => a.status === "scheduled").length} />
        <StatCard label="At-Risk Suppliers" value={atRiskSuppliers.length} />
        <StatCard label="CAPA Effectiveness" value={capaEffectivenessRate === null ? "—" : `${capaEffectivenessRate}%`} />
        <StatCard label="Items Below Min" value={openBelowMinAlerts} />
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

          {/* Computed from real delivery/reorder/alert data (see Supplier Performance
              Analytics) — distinct from the manually-entered scorecard riskLevel above. */}
          <div className="mt-3 grid grid-cols-3 gap-2 border-t border-border pt-3 text-center">
            <div>
              <p className="text-lg font-semibold tabular-nums">{suppliersAtRisk}</p>
              <p className="text-xs text-muted-foreground">Suppliers at Risk</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums">{avgDeliveryTime === null ? "—" : `${avgDeliveryTime.toFixed(1)}d`}</p>
              <p className="text-xs text-muted-foreground">Avg Delivery Time</p>
            </div>
            <div>
              <p className="text-lg font-semibold tabular-nums">{avgDeliveryAccuracy === null ? "—" : `${avgDeliveryAccuracy.toFixed(0)}%`}</p>
              <p className="text-xs text-muted-foreground">Avg Delivery Accuracy</p>
            </div>
          </div>
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Inventory Overview</h2>
          <RecheckMinMaxButton />
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-6">
          <StatCard label="Reorder Pending" value={countByState("reorder_pending")} />
          <StatCard label="On Order" value={countByState("on_order")} />
          <StatCard label="Overstock" value={countByState("overstock")} />
          <StatCard label="Active Alerts" value={openAlertsTotal} />
          <StatCard label="Acknowledged Alerts" value={acknowledgedAlertsTotal} />
          <StatCard label="Reorder Requests Pending" value={pendingReorderRequests} />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-3">
          <StatCard label="Total Inventory Value" value={costingSummary ? `$${costingSummary.totalInventoryValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : "—"} />
          <StatCard
            label={`Scrap Cost (${costingSummary?.days ?? 30}d)`}
            value={costingSummary ? `$${costingSummary.totalScrapCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
          />
          <StatCard
            label={`Consumption Cost (${costingSummary?.days ?? 30}d)`}
            value={costingSummary ? `$${costingSummary.totalConsumptionCost.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—"}
          />
        </div>
        {costingSummary && costingSummary.uncostedItemCount > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {costingSummary.uncostedItemCount} item{costingSummary.uncostedItemCount === 1 ? "" : "s"} have no unit cost set and are
            excluded from these totals.
          </p>
        )}
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium">Items by State</h3>
            <Link to="/inventory/alerts" className="text-xs text-primary hover:underline">
              View alerts
            </Link>
          </div>
          <InventoryStateChart data={inventoryStateData} />
        </div>

        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Movement Trends (last {movementTrends?.days ?? 30} days)</h3>
            <MovementTrendsChart data={movementTrends?.data ?? []} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Consumption vs Receiving (last {consumptionVsReceiving?.days ?? 30} days)</h3>
            <ConsumptionVsReceivingChart data={consumptionVsReceiving?.data ?? []} />
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Scrap Distribution</h3>
            <ScrapDistributionChart data={scrapAnalytics?.byItem ?? []} />
            {scrapAnalytics && scrapAnalytics.byReferenceType.length > 0 && (
              <div className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
                <p className="mb-1 font-medium text-foreground">By reference type</p>
                <ul className="flex flex-col gap-1">
                  {scrapAnalytics.byReferenceType.map((r) => (
                    <li key={r.referenceType} className="flex items-center justify-between">
                      <span className="capitalize">{r.referenceType.replace(/_/g, " ")}</span>
                      <span className="tabular-nums">{r.quantity}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Movements by Reference Type</h3>
            {referenceSummary.length === 0 ? (
              <p className="text-sm text-muted-foreground">No movements logged yet.</p>
            ) : (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="pb-2">Reference Type</th>
                    <th className="pb-2">Movements</th>
                    <th className="pb-2">Total Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  {referenceSummary.map((r) => (
                    <tr key={r.referenceType ?? "none"} className="border-t border-border">
                      <td className="py-1.5 capitalize">{r.referenceType ? r.referenceType.replace(/_/g, " ") : "None (unset)"}</td>
                      <td className="py-1.5">{r.count}</td>
                      <td className="py-1.5">{r.quantity}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <h3 className="mb-2 text-sm font-medium">Supplier Cost Distribution</h3>
            <SupplierCostChart data={costingSummary?.supplierCostDistribution.filter((s) => s.itemValue > 0).map((s) => ({ supplierName: s.supplierName, itemValue: s.itemValue })) ?? []} />
          </div>
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">ERP Overview</h2>
          <Link to="/erp" className="text-xs text-primary hover:underline">
            View purchase orders
          </Link>
        </div>
        <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
          <StatCard label="Draft" value={erpOverview?.countByStatus.draft ?? 0} />
          <StatCard label="Sent" value={erpOverview?.countByStatus.sent ?? 0} />
          <StatCard label="Partially Received" value={erpOverview?.countByStatus.partially_received ?? 0} />
          <StatCard label="Received" value={erpOverview?.countByStatus.received ?? 0} />
          <StatCard label="Cancelled" value={erpOverview?.countByStatus.cancelled ?? 0} />
        </div>
        <div className="mt-4 grid grid-cols-2 gap-4 md:grid-cols-5">
          <Link to="/work-orders">
            <StatCard label="Open Work Orders" value={openWorkOrders} />
          </Link>
          <Link to="/erp/requisitions">
            <StatCard label="Requisitions Pending Approval" value={requisitionsPendingApproval} />
          </Link>
        </div>
        <div className="mt-4 rounded-lg border border-border bg-card p-4">
          <h3 className="mb-2 text-sm font-medium">Recent Purchase Orders</h3>
          {!erpOverview || erpOverview.recent.length === 0 ? (
            <p className="text-sm text-muted-foreground">No purchase orders yet.</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {erpOverview.recent.map((po) => (
                <li key={po.id} className="flex items-center justify-between border-b border-border pb-1.5 last:border-0">
                  <Link to={`/erp/${po.id}`} className="text-primary hover:underline">
                    PO #{po.id} — {po.supplierName}
                  </Link>
                  <StatusBadge value={po.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {currentUser?.roleName === "admin" && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Tenant Configuration</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Link to="/admin/tenant-branding" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50">
              <Palette size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Branding</span>
            </Link>
            <Link to="/admin/tenant-templates" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50">
              <FileUp size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Templates</span>
            </Link>
            <Link to="/admin/tenant-ai" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50">
              <Bot size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">AI Config</span>
            </Link>
            <Link to="/admin/digital-twin" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50">
              <Cpu size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Digital Twin Setup</span>
            </Link>
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-3 text-lg font-semibold">Workflow Overview</h2>
        <WorkflowDashboard />
      </div>
    </div>
  );
}
