import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { PageHeader } from "../../components/layout/PageHeader";
import { useOpenTab } from "../../hooks/useOpenTab";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { ExecutiveDrillPanel, type DrillListRow } from "../../components/executive/ExecutiveDrillPanel";
import { KpiChartCustomize, KpiPinnedCharts } from "../../components/kpis/KpiBoards";
import { UpdatedStamp } from "../../components/kpis/UpdatedStamp";
import { useKpis } from "../../hooks/useKpis";
import { useSiteStore } from "../../store/siteStore";
import { defaultPlantView, summaryFor } from "../../lib/kpiView";
import { canViewModule, drillDetail, drillHeading, drillTooltip, executiveListPath, permissionMessage, tabIconForHref, type DrillTarget } from "../../lib/executiveDrill";
import type { PlantView } from "../../lib/kpiView";

interface Figure {
  label: string;
  value: number;
  bucket: string;
}

interface WidgetView {
  id: string;
  kind: string;
  title: string;
  metric: string;
  dateRange: string;
  dateRangeLabel: string;
  figures: Figure[];
}

interface ColumnView {
  siteId: number | null;
  siteName: string;
  widgets: WidgetView[];
}

interface MetricChoice {
  id: string;
  label: string;
}

interface CatalogItem {
  kind: string;
  label: string;
  metrics: MetricChoice[];
  dateRanges: { id: string; label: string }[];
}

interface DashboardLayout {
  version: 1;
  widgets: { id: string; kind: string; metric: string; dateRange: string }[];
}

interface DashboardPayload {
  customized: boolean;
  layout: DashboardLayout;
  catalog: CatalogItem[];
  columns: ColumnView[];
}

interface DrillPayload {
  title: string;
  siteName: string;
  total: number;
  rows: DrillListRow[];
}

interface OpenPanel {
  target: DrillTarget;
  data: DrillPayload;
  denied: string | null;
}

function newWidgetId(kind: string, existing: { id: string }[]): string {
  const base = kind.slice(0, 24);
  let id = base;
  let n = 2;
  const taken = new Set(existing.map((widget) => widget.id));
  while (taken.has(id)) {
    id = `${base}-${n}`.slice(0, 40);
    n += 1;
  }
  return id;
}

const SEGMENT_COLORS = ["hsl(var(--primary))", "hsl(200 65% 42%)", "hsl(32 88% 46%)", "hsl(152 42% 36%)", "hsl(280 35% 46%)", "hsl(350 55% 46%)"];

export function ExecutiveDashboardPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const openTab = useOpenTab();
  const { effective, isLoading: permissionsLoading } = useEffectivePermissions();
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [panel, setPanel] = useState<OpenPanel | null>(null);
  const [kpiPanel, setKpiPanel] = useState<{ title: string; detail: string | null; total: number; rows: DrillListRow[]; note: string | null; denied: string | null } | null>(null);
  const [openingKey, setOpeningKey] = useState<string | null>(null);

  const dashboard = useQuery({
    queryKey: ["executive"],
    queryFn: async () => (await apiClient.get<DashboardPayload>("/executive")).data,
    refetchInterval: 60_000,
  });

  const layout = draft ?? dashboard.data?.layout ?? null;

  const save = useMutation({
    mutationFn: async (next: DashboardLayout) => (await apiClient.put<DashboardPayload>("/executive/layout", next)).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["executive"], data);
      setDraft(null);
      setCustomizing(false);
      toast.success("Dashboard saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save the dashboard.")),
  });

  const reset = useMutation({
    mutationFn: async () => (await apiClient.delete<DashboardPayload>("/executive/layout")).data,
    onSuccess: (data) => {
      queryClient.setQueryData(["executive"], data);
      setDraft(null);
      setCustomizing(false);
      toast.success("Dashboard reset.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't reset the dashboard.")),
  });

  const catalog = dashboard.data?.catalog ?? [];
  const catalogByKind = useMemo(() => new Map(catalog.map((item) => [item.kind, item])), [catalog]);

  if (dashboard.isLoading) return <LoadingPlaceholder />;
  if (dashboard.isError && axios.isAxiosError(dashboard.error) && dashboard.error.response?.status === 403) {
    return <p className="rounded-lg border border-border bg-card p-4 text-sm text-foreground">You don't have access to the executive dashboard.</p>;
  }
  if (dashboard.isError || !dashboard.data || !layout) {
    return <p className="text-sm text-destructive">Couldn't load the executive dashboard.</p>;
  }

  const columns = dashboard.data.columns;

  async function openFigure(target: DrillTarget) {
    if (target.value <= 0) return;
    const key = `${target.siteName}-${target.kind}-${target.bucket}`;
    setOpeningKey(key);
    try {
      const params = new URLSearchParams({
        kind: target.kind,
        bucket: target.bucket,
        dateRange: target.dateRange,
        siteId: target.siteId == null ? "unassigned" : String(target.siteId),
      });
      setKpiPanel(null);
      const data = (await apiClient.get<DrillPayload>(`/executive/records?${params.toString()}`)).data;
      const only = data.total === 1 ? data.rows[0] : undefined;
      if (only?.href) {
        if (!canViewModule(only.module, effective, permissionsLoading)) {
          setPanel({ target: { ...target, value: data.total }, data, denied: permissionMessage(only.module) });
          return;
        }
        openTab({ path: only.href, title: `${only.recordNumber} ${only.title}`.trim(), icon: tabIconForHref(only.href) });
        setPanel(null);
        return;
      }
      setPanel({ target: { ...target, value: data.total, siteName: data.siteName || target.siteName }, data, denied: null });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't open those records."));
    } finally {
      setOpeningKey(null);
    }
  }

  async function openKpiRecords(metricId: string, month: string, plant: PlantView) {
    try {
      const data = (
        await apiClient.get<{ title: string; siteName: string; total: number; note: string | null; rows: DrillListRow[] }>("/kpis/records", {
          params: { metric: metricId, month, siteId: plant === "all" ? "all" : String(plant) },
        })
      ).data;
      setPanel(null);
      setKpiPanel({ title: data.title, detail: data.siteName, total: data.total, rows: data.rows, note: data.note, denied: null });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't open those records."));
    }
  }

  function openFullList(target: DrillTarget) {
    openTab({ path: executiveListPath(target), title: drillHeading(target), icon: "dashboard" });
  }

  function updateWidget(id: string, patch: Partial<DashboardLayout["widgets"][number]>) {
    setDraft({
      version: 1,
      widgets: (draft ?? dashboard.data!.layout).widgets.map((widget) => (widget.id === id ? { ...widget, ...patch } : widget)),
    });
  }

  function addWidget(kind: string) {
    const item = catalogByKind.get(kind);
    if (!item) return;
    const current = draft ?? dashboard.data!.layout;
    setDraft({
      version: 1,
      widgets: [
        ...current.widgets,
        {
          id: newWidgetId(kind, current.widgets),
          kind,
          metric: item.metrics[0]?.id ?? "summary",
          dateRange: item.dateRanges.find((range) => range.id === "90d")?.id ?? item.dateRanges[0]?.id ?? "90d",
        },
      ],
    });
    setCustomizing(true);
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        crumbs={[{ label: "Home", to: "/" }, { label: "Executive dashboard" }]}
        title="Executive dashboard"
        description={
          <div className="flex flex-col gap-1">
            <span>Greer and Wellman, side by side. Numbers open the matching records.</span>
            {dashboard.isSuccess && <UpdatedStamp at={new Date(dashboard.dataUpdatedAt)} />}
          </div>
        }
        actions={
          <>
          {customizing ? (
            <>
              <button
                type="button"
                className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
                disabled={save.isPending || layout.widgets.length === 0}
                onClick={() => save.mutate(layout)}
              >
                {save.isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground"
                onClick={() => {
                  setDraft(null);
                  setCustomizing(false);
                }}
              >
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground" onClick={() => setCustomizing(true)}>
              Customize
            </button>
          )}
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-sm text-foreground disabled:opacity-60"
            disabled={reset.isPending || (!dashboard.data.customized && !draft)}
            onClick={() => reset.mutate()}
          >
            Reset
          </button>
          </>
        }
      />

      {customizing && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-card p-3">
          <label className="text-sm text-foreground">
            Add widget
            <select
              aria-label="Add widget"
              className="ml-2 rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) addWidget(e.target.value);
                e.target.value = "";
              }}
            >
              <option value="">Choose…</option>
              {catalog.map((item) => (
                <option key={item.kind} value={item.kind}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <p className="text-xs text-muted-foreground">This layout is saved for you. Reset puts the standard dashboard back.</p>
          <div className="w-full">
            <KpiChartCustomize surface="executive" />
          </div>
        </div>
      )}

      <ObjectivesTile />
      <KpiPinnedCharts surface="executive" onOpen={(metricId, month, plant) => void openKpiRecords(metricId, month, plant)} />

      {columns.length === 0 ? (
        <p className="text-sm text-muted-foreground">No plants are available for this dashboard.</p>
      ) : (
        <div className="grid items-start gap-4 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(16rem, 1fr))` }}>
          {columns.map((column) => (
            <section key={column.siteName} className="flex min-w-0 flex-col gap-3">
              <h2 className="truncate text-lg font-semibold text-foreground" title={column.siteName}>
                {column.siteName}
              </h2>
              {(customizing ? layout.widgets : column.widgets).map((widget) => {
                const live = column.widgets.find((item) => item.id === widget.id);
                const item = catalogByKind.get(widget.kind);
                const figures = live?.figures ?? [];
                const dateRange = live?.dateRange ?? widget.dateRange;
                const targets = figures.map((figure) => ({
                  kind: widget.kind,
                  bucket: figure.bucket,
                  label: figure.label,
                  dateRange,
                  siteId: column.siteId,
                  siteName: column.siteName,
                  value: figure.value,
                }));
                const cardTarget = targets.find((target) => target.bucket === "open" && target.value > 0) ?? targets.find((target) => target.value > 0) ?? null;
                const chart = targets.filter((target) => target.value > 0);
                const chartTotal = chart.reduce((sum, target) => sum + target.value, 0);
                return (
                  <article key={`${column.siteName}-${widget.id}`} className="aq-panel p-4">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        {cardTarget ? (
                          <button
                            type="button"
                            className="block max-w-full cursor-pointer truncate rounded-md text-left text-sm font-medium text-foreground hover:underline focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
                            title={drillTooltip(cardTarget)}
                            onClick={() => void openFigure(cardTarget)}
                          >
                            {live?.title ?? item?.label ?? widget.kind}
                          </button>
                        ) : (
                          <h3 className="truncate text-sm font-medium text-muted-foreground" title="Nothing to open">
                            {live?.title ?? item?.label ?? widget.kind}
                          </h3>
                        )}
                        <p className="truncate text-xs text-muted-foreground" title={live?.dateRangeLabel}>
                          {live?.dateRangeLabel}
                        </p>
                      </div>
                      {customizing && (
                        <button
                          type="button"
                          className="text-xs text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            setDraft({
                              version: 1,
                              widgets: layout.widgets.filter((row) => row.id !== widget.id),
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </div>
                    {customizing && item && (
                      <div className="mb-2 flex flex-col gap-2">
                        <select
                          aria-label={`${item.label} metric`}
                          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                          value={widget.metric}
                          onChange={(e) => updateWidget(widget.id, { metric: e.target.value })}
                        >
                          {item.metrics.map((metric) => (
                            <option key={metric.id} value={metric.id}>
                              {metric.label}
                            </option>
                          ))}
                        </select>
                        <select
                          aria-label={`${item.label} date range`}
                          className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
                          value={widget.dateRange}
                          onChange={(e) => updateWidget(widget.id, { dateRange: e.target.value })}
                        >
                          {item.dateRanges.map((range) => (
                            <option key={range.id} value={range.id}>
                              {range.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}
                    {chart.length > 1 && chartTotal > 0 && (
                      <div className="mb-2 flex h-3 overflow-hidden rounded-full" role="group" aria-label={`${live?.title ?? widget.kind} chart`}>
                        {chart.map((target, index) => (
                          <button
                            key={`${target.bucket}-bar`}
                            type="button"
                            className="h-full min-w-1 cursor-pointer hover:opacity-80 focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
                            style={{ width: `${(target.value / chartTotal) * 100}%`, background: SEGMENT_COLORS[index % SEGMENT_COLORS.length] }}
                            title={drillTooltip(target)}
                            aria-label={drillTooltip(target)}
                            onClick={() => void openFigure(target)}
                          />
                        ))}
                      </div>
                    )}
                    <ul className="flex flex-col gap-1">
                      {targets.map((target) => {
                        const clickable = target.value > 0;
                        const key = `${target.siteName}-${target.kind}-${target.bucket}`;
                        const tip = drillTooltip(target);
                        return (
                          <li key={`${widget.id}-${target.bucket}-${target.label}`}>
                            <button
                              type="button"
                              className={
                                clickable
                                  ? "flex w-full cursor-pointer items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted focus-visible:outline focus-visible:ring-2 focus-visible:ring-ring"
                                  : "flex w-full cursor-not-allowed items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left opacity-70"
                              }
                              title={tip}
                              aria-disabled={clickable ? undefined : true}
                              onClick={() => {
                                if (clickable) void openFigure(target);
                              }}
                            >
                              <span className="truncate text-sm text-muted-foreground">{target.label}</span>
                              <span className="text-sm font-semibold text-foreground">{openingKey === key ? "…" : target.value}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {panel && (
        <ExecutiveDrillPanel
          title={drillHeading(panel.target)}
          detail={drillDetail(panel.target.kind, panel.target.bucket)}
          total={panel.data.total}
          rows={panel.data.rows}
          denied={panel.denied}
          onClose={() => setPanel(null)}
          onDenied={(message) => setPanel({ ...panel, denied: message })}
          onOpenFullList={() => openFullList(panel.target)}
        />
      )}
      {kpiPanel && (
        <ExecutiveDrillPanel
          title={kpiPanel.title}
          detail={kpiPanel.detail}
          total={kpiPanel.total}
          rows={kpiPanel.rows}
          note={kpiPanel.note}
          denied={kpiPanel.denied}
          onClose={() => setKpiPanel(null)}
          onDenied={(message) => setKpiPanel({ ...kpiPanel, denied: message })}
        />
      )}
    </div>
  );
}

function ObjectivesTile() {
  const openTab = useOpenTab();
  const { query } = useKpis();
  const siteScope = useSiteStore((state) => state.siteScope);
  const currentSiteId = useSiteStore((state) => state.currentSiteId);
  const data = query.data;
  const plant = data ? defaultPlantView(data.plants, siteScope, currentSiteId) : "all";
  const summary = data ? summaryFor(data.objectives, plant, data.plants) : null;
  const label = summary ? `Quality Objectives: ${summary.onTarget} of ${summary.active} on target` : "Quality Objectives";
  return (
    <button
      type="button"
      className="w-full rounded-lg border border-border bg-card px-4 py-3 text-left text-sm font-semibold text-foreground hover:bg-muted"
      onClick={() => openTab({ path: "/kpis", title: "Quality Objectives & KPIs", icon: "dashboard" })}
    >
      {label}
    </button>
  );
}
