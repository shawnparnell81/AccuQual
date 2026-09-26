import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
import { usePersonDirectory } from "../../hooks/usePersonDirectory";
import { isPastDue } from "../../lib/opsLanguage";
import { HealthRing, KpiTile, Reveal, SegmentedTabs, AnimatedNumber, type Tone } from "../../components/dashboard/kit";
import { ActivityFeed, StatusBoard, TrendPanel, type FeedEvent, type StatusCell, type TrendPoint } from "../../components/dashboard/CommandCenter";
import { Palette, FileUp, Bot, Cpu, AlertTriangle, PackageMinus, ClipboardCheck, ShieldAlert, ChevronRight, SlidersHorizontal, RotateCcw, Check } from "lucide-react";
import { LayoutSection } from "../../components/dashboard/LayoutSection";
import { DASHBOARD_SECTION_LABELS, useDashboardLayout, type DashboardSectionId } from "../../hooks/useDashboardLayout";

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

export function StatCard({ label, value, tone = "primary" }: { label: string; value: number | string; tone?: Tone }) {
  return (
    <div className="kpi-tile kpi-hover rounded-xl p-4" style={{ ["--tone" as string]: tone === "danger" ? "var(--destructive)" : `var(--${tone})` }}>
      <p className="relative text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
      <p className="relative mt-1 text-2xl font-semibold tabular-nums">
        <AnimatedNumber value={value} />
      </p>
    </div>
  );
}

const TABS = [
  { key: "quality", label: "Quality" },
  { key: "inventory", label: "Inventory" },
  { key: "purchasing", label: "Purchasing" },
  { key: "workflow", label: "Workflows" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

/** Items opened per week over the last `weeks` weeks, oldest first. */
function weeklyCounts(dates: (string | null | undefined)[], weeks = 8): number[] {
  const now = Date.now();
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const buckets = Array.from({ length: weeks }, () => 0);
  for (const d of dates) {
    if (!d) continue;
    const age = Math.floor((now - new Date(d).getTime()) / weekMs);
    if (age >= 0 && age < weeks) buckets[weeks - 1 - age]! += 1;
  }
  return buckets;
}

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** Dashboard: NCR severity chart, CAPA status overview, audit calendar widget, supplier scorecards, AI insights panel. */
export function DashboardPage() {
  const currentUser = useCurrentUser();
  const { data: ncrs = [], dataUpdatedAt } = ncrHooks.useList();
  const queryClient = useQueryClient();

  // A live board: the lists behind it refresh every minute while the page is open.
  useEffect(() => {
    const timer = setInterval(() => {
      queryClient.invalidateQueries({ predicate: (q) => ["ncr", "capa", "inventory/alerts", "work-orders", "erp/requisitions"].includes(String(q.queryKey[0])) });
    }, 60_000);
    return () => clearInterval(timer);
  }, [queryClient]);
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

  const [params, setParams] = useSearchParams();
  const requestedTab = params.get("tab");
  const tab: TabKey = TABS.some((t) => t.key === requestedTab) ? (requestedTab as TabKey) : "quality";
  const { label: personLabel } = usePersonDirectory();

  const openNcrs = ncrs.filter((n) => n.status !== "closed");
  const openFixRows = capas.filter((c) => c.status !== "closed");
  const lateRows = [
    ...openNcrs
      .filter((n) => isPastDue(n.dueDate, false))
      .map((n) => ({ key: `ncr-${n.id}`, title: `Issue #${n.id} — ${n.title}`, who: personLabel(n.assignedTo), due: n.dueDate!.slice(0, 10), href: `/ncr/${n.id}` })),
    ...openFixRows
      .filter((c) => isPastDue(c.dueDate, false))
      .map((c) => ({ key: `capa-${c.id}`, title: `Fix #${c.id}`, who: personLabel(c.ownerId), due: c.dueDate!.slice(0, 10), href: `/capa/${c.id}` })),
  ].sort((a, b) => a.due.localeCompare(b.due));
  const openTotal = openNcrs.length + openFixRows.length;
  const onTimePct = openTotal === 0 ? 100 : Math.round((1 - lateRows.length / openTotal) * 100);
  const onTimeTone: Tone = onTimePct >= 90 ? "success" : onTimePct >= 70 ? "warning" : "danger";
  const criticalOpen = openNcrs.filter((n) => n.severity === "critical").length;
  const firstName = currentUser?.name?.split(" ")[0];

  const summaryBits = [
    lateRows.length > 0 ? `${lateRows.length} ${lateRows.length === 1 ? "item is" : "items are"} past due` : "Nothing is past due",
    openBelowMinAlerts > 0 ? `${openBelowMinAlerts} ${openBelowMinAlerts === 1 ? "item is" : "items are"} below minimum stock` : null,
    requisitionsPendingApproval > 0 ? `${requisitionsPendingApproval} ${requisitionsPendingApproval === 1 ? "requisition needs" : "requisitions need"} approval` : null,
  ].filter(Boolean);

  const attention: { key: string; title: string; detail: string; href: string; tone: Tone; icon: "late" | "stock" | "supplier" | "approval" }[] = [
    ...lateRows.slice(0, 5).map((r) => ({ key: r.key, title: r.title, detail: `${r.who} · due ${r.due}`, href: r.href, tone: "danger" as Tone, icon: "late" as const })),
    ...(openBelowMinAlerts > 0
      ? [{ key: "stock", title: `${openBelowMinAlerts} ${openBelowMinAlerts === 1 ? "item" : "items"} below minimum stock`, detail: "Review reorder needs", href: "/inventory/alerts", tone: "warning" as Tone, icon: "stock" as const }]
      : []),
    ...(suppliersAtRisk > 0
      ? [{ key: "supplier", title: `${suppliersAtRisk} ${suppliersAtRisk === 1 ? "supplier" : "suppliers"} at risk`, detail: "Based on delivery and quality history", href: "/suppliers", tone: "warning" as Tone, icon: "supplier" as const }]
      : []),
    ...(requisitionsPendingApproval > 0
      ? [{ key: "reqs", title: `${requisitionsPendingApproval} ${requisitionsPendingApproval === 1 ? "requisition" : "requisitions"} waiting on approval`, detail: "Purchasing", href: "/erp/requisitions", tone: "primary" as Tone, icon: "approval" as const }]
      : []),
  ];
  const trend: TrendPoint[] = (() => {
    const weeks = 12;
    const weekMs = 7 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    const points = Array.from({ length: weeks }, (_, i) => {
      const start = new Date(now - (weeks - 1 - i) * weekMs);
      return { label: start.toLocaleDateString(undefined, { month: "short", day: "numeric" }), opened: 0, closed: 0 };
    });
    const bucket = (iso: string | null | undefined, key: "opened" | "closed") => {
      if (!iso) return;
      const age = Math.floor((now - new Date(iso).getTime()) / weekMs);
      if (age >= 0 && age < weeks) points[weeks - 1 - age]![key] += 1;
    };
    for (const n of ncrs) {
      bucket(n.createdAt, "opened");
      bucket(n.closedAt, "closed");
    }
    for (const c of capas) {
      bucket(c.createdAt, "opened");
      bucket(c.closedAt, "closed");
    }
    return points;
  })();

  const feed: FeedEvent[] = [
    ...ncrs.map((n) => ({ key: `n-${n.id}`, at: n.createdAt, title: `Issue #${n.id} opened`, detail: n.title, tone: (n.severity === "critical" ? "danger" : "warning") as Tone, href: `/ncr/${n.id}` })),
    ...ncrs.filter((n) => n.closedAt).map((n) => ({ key: `nc-${n.id}`, at: n.closedAt!, title: `Issue #${n.id} closed`, detail: n.title, tone: "success" as Tone, href: `/ncr/${n.id}` })),
    ...capas.map((c) => ({ key: `c-${c.id}`, at: c.createdAt, title: `Fix #${c.id} started`, detail: c.ncrId ? `For issue #${c.ncrId}` : "Corrective action", tone: "info" as Tone, href: `/capa/${c.id}` })),
    ...capas.filter((c) => c.closedAt).map((c) => ({ key: `cc-${c.id}`, at: c.closedAt!, title: `Fix #${c.id} closed`, detail: c.ncrId ? `For issue #${c.ncrId}` : "Corrective action", tone: "success" as Tone, href: `/capa/${c.id}` })),
    ...inventoryAlerts.filter((a) => !a.acknowledgedAt).map((a) => ({ key: `a-${a.id}`, at: a.triggeredAt, title: `${a.sku} ${a.alertType === "below_min" ? "is below minimum" : "is overstocked"}`, detail: a.description ?? "Stock alert", tone: "warning" as Tone, href: "/inventory/alerts" })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 8);

  const stateOf = (tone: Tone) => (tone === "success" ? "Healthy" : tone === "warning" ? "Watch" : tone === "danger" ? "Action needed" : "Active");
  const boardTones = {
    quality: (criticalOpen > 0 ? "danger" : lateRows.length > 0 ? "warning" : "success") as Tone,
    fixes: (openFixRows.some((c) => isPastDue(c.dueDate, false)) ? "warning" : "success") as Tone,
    stock: (openBelowMinAlerts > 0 ? "warning" : "success") as Tone,
    suppliers: (suppliersAtRisk > 0 ? "warning" : "success") as Tone,
    purchasing: (requisitionsPendingApproval > 0 ? "primary" : "success") as Tone,
    production: "info" as Tone,
  };
  const board: StatusCell[] = [
    { key: "quality", label: "Quality", state: stateOf(boardTones.quality), detail: `${openNcrs.length} open issues`, tone: boardTones.quality, href: "/ncr" },
    { key: "fixes", label: "Fixes", state: stateOf(boardTones.fixes), detail: `${openCapas} in progress`, tone: boardTones.fixes, href: "/capa" },
    { key: "stock", label: "Inventory", state: stateOf(boardTones.stock), detail: `${openBelowMinAlerts} below minimum`, tone: boardTones.stock, href: "/inventory/alerts" },
    { key: "suppliers", label: "Suppliers", state: stateOf(boardTones.suppliers), detail: `${suppliersAtRisk} at risk`, tone: boardTones.suppliers, href: "/suppliers" },
    { key: "purchasing", label: "Purchasing", state: requisitionsPendingApproval > 0 ? "Awaiting approval" : "Healthy", detail: `${requisitionsPendingApproval} requisitions waiting`, tone: boardTones.purchasing, href: "/erp/requisitions" },
    { key: "production", label: "Production", state: openWorkOrders > 0 ? "Running" : "Idle", detail: `${openWorkOrders} open work orders`, tone: boardTones.production, href: "/work-orders" },
  ];
  const updatedAt = dataUpdatedAt ? new Date(dataUpdatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;

  const attentionIcon = { late: AlertTriangle, stock: PackageMinus, supplier: ShieldAlert, approval: ClipboardCheck } as const;
  const toneVar = (tone: Tone) => (tone === "danger" ? "destructive" : tone);
  const layout = useDashboardLayout();
  const [draggingSection, setDraggingSection] = useState<DashboardSectionId | null>(null);

  const sectionNodes: Record<DashboardSectionId, ReactNode> = {
    status: (
      <>
      <StatusBoard cells={board} />
      </>
    ),
    kpis: (
      <>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <KpiTile
          index={1}
          label="Open issues"
          value={openNcrs.length}
          trend={weeklyCounts(ncrs.map((n) => n.createdAt))}
          sub={criticalOpen > 0 ? `${criticalOpen} critical` : "None critical"}
          tone={criticalOpen > 0 ? "danger" : "primary"}
          href="/ncr"
        />
        <KpiTile index={2} label="Open fixes" value={openCapas} trend={weeklyCounts(capas.map((c) => c.createdAt))} sub="Corrective actions" tone="info" href="/capa" />
        <KpiTile index={3} label="Past due" value={lateRows.length} sub={lateRows.length === 0 ? "All on schedule" : "Need a nudge"} tone={lateRows.length > 0 ? "danger" : "success"} />
        <KpiTile index={4} label="Suppliers at risk" value={suppliersAtRisk} sub="Delivery + quality" tone={suppliersAtRisk > 0 ? "warning" : "success"} href="/suppliers" />
        <KpiTile index={5} label="Below minimum" value={openBelowMinAlerts} sub="Stock alerts" tone={openBelowMinAlerts > 0 ? "warning" : "success"} href="/inventory/alerts" />
      </div>
      </>
    ),
    trend: (
      <>
      <div className="grid gap-4 lg:grid-cols-3">
        <Reveal index={5} className="lg:col-span-2">
          <TrendPanel data={trend} />
        </Reveal>
        <Reveal index={6}>
          <ActivityFeed events={feed} />
        </Reveal>
      </div>
      </>
    ),
    attention: (
      <>
      <div className="grid gap-4 lg:grid-cols-5">
        <Reveal index={6} className="lg:col-span-3">
          <div className="h-full rounded-xl border border-border bg-card p-5">
            <h2 className="mb-3 text-sm font-semibold">Needs attention</h2>
            {attention.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success/15 text-success">
                  <ClipboardCheck size={22} />
                </span>
                <p className="font-medium">All clear</p>
                <p className="text-sm text-muted-foreground">Nothing is late and nothing is waiting on you.</p>
              </div>
            ) : (
              <ul className="flex flex-col gap-1">
                {attention.map((row) => {
                  const Icon = attentionIcon[row.icon];
                  return (
                    <li key={row.key}>
                      <Link to={row.href} className="group flex items-center gap-3 rounded-lg p-2.5 hover:bg-muted/60">
                        <span
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                          style={{ background: `hsl(var(--${toneVar(row.tone)}) / 0.16)`, color: `hsl(var(--${toneVar(row.tone)}))` }}
                        >
                          <Icon size={17} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{row.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">{row.detail}</span>
                        </span>
                        <ChevronRight size={16} className="text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </Reveal>
        <Reveal index={7} className="lg:col-span-2">
          <div className="h-full rounded-xl border border-border bg-card p-5">
            <h2 className="mb-2 text-sm font-semibold">Issues by severity</h2>
            <SeverityChart data={severityData} />
          </div>
        </Reveal>
      </div>
      </>
    ),
    detail: (
      <div className="flex flex-col gap-8">
      <SegmentedTabs tabs={[...TABS]} value={tab} onChange={(key) => setParams(key === "quality" ? {} : { tab: key }, { replace: true })} />

      {tab === "quality" && (
      <div className="grid gap-4 lg:grid-cols-2">
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
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium">Corrective Action Effectiveness</h2>
            <span className="text-sm font-semibold tabular-nums text-primary">{capaEffectivenessRate === null ? "—" : `${capaEffectivenessRate}% closed`}</span>
          </div>
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
      )}

      {tab === "inventory" && (
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
            <Link to="/inventory/alerts" className="text-xs text-accent hover:underline">
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
      )}

      {tab === "purchasing" && (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold">ERP Overview</h2>
          <Link to="/erp" className="text-xs text-accent hover:underline">
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
                  <Link to={`/erp/${po.id}`} className="text-accent hover:underline">
                    PO #{po.id} — {po.supplierName}
                  </Link>
                  <StatusBadge value={po.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      )}

      {tab === "workflow" && (
      <div>
        <h2 className="mb-3 text-lg font-semibold">Workflow Overview</h2>
        <WorkflowDashboard />
      </div>
      )}
      </div>
    ),
  };

  return (
    <div className="flex flex-col gap-8">
      <Reveal>
        <div className="hero-surface rounded-2xl p-6 md:p-8">
          <div className="cc-grid" aria-hidden />
          <div className="cc-orbs" aria-hidden />
          <div className="absolute right-4 top-4 z-10 flex items-center gap-2">
            {layout.editing ? (
              <>
                <button type="button" onClick={layout.reset} className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2.5 py-1 text-xs hover:bg-muted">
                  <RotateCcw size={12} /> Reset
                </button>
                <button type="button" onClick={() => layout.setEditing(false)} className="flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
                  <Check size={12} /> Done
                </button>
              </>
            ) : (
              <button type="button" onClick={() => layout.setEditing(true)} className="flex items-center gap-1.5 rounded-md border border-border bg-card/80 px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
                <SlidersHorizontal size={12} /> Customize
              </button>
            )}
          </div>
          <div className="relative flex flex-wrap items-center justify-between gap-6">
            <div>
              <p className="flex items-center gap-2 text-xs font-medium uppercase tracking-widest text-primary">
                <span className="led" /> Live · Plant pulse{updatedAt ? <span className="font-normal normal-case tracking-normal text-muted-foreground"> · updated {updatedAt}</span> : null}
              </p>
              <h1 className="glow-text mt-2 text-4xl font-semibold md:text-5xl">
                {greeting()}
                {firstName ? `, ${firstName}` : ""}
              </h1>
              <p className="mt-2 max-w-xl text-muted-foreground">{summaryBits.join(" · ")}.</p>
            </div>
            <HealthRing
              value={onTimePct}
              label="On-time rate"
              sub={openTotal === 0 ? "No open issues or fixes" : `${openTotal - lateRows.length} of ${openTotal} open items on schedule`}
              tone={onTimeTone}
            />
          </div>
        </div>
      </Reveal>

      {layout.editing && <p className="-mb-4 text-sm text-muted-foreground">Drag a section to where you want it. Your arrangement is saved on this browser for your account.</p>}
      {layout.order.map((id) => (
        <LayoutSection key={id} id={id} label={DASHBOARD_SECTION_LABELS[id]} editing={layout.editing} onMove={layout.move} dragging={draggingSection} setDragging={setDraggingSection}>
          {sectionNodes[id]}
        </LayoutSection>
      ))}

      {currentUser?.roleName === "admin" && (
        <div>
          <h2 className="mb-3 text-lg font-semibold">Company Configuration</h2>
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <Link to="/admin/company-branding" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50">
              <Palette size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Branding</span>
            </Link>
            <Link to="/admin/company-templates" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50">
              <FileUp size={18} className="text-muted-foreground" />
              <span className="text-sm font-medium">Templates</span>
            </Link>
            <Link to="/admin/company-ai" className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 hover:bg-muted/50">
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
    </div>
  );
}
