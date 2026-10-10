import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

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

interface DrillRow {
  recordNumber: string;
  title: string;
  status: string;
  ageLabel: string;
  href: string | null;
}

interface DrillPayload {
  title: string;
  siteName: string;
  rows: DrillRow[];
}

interface DrillRequest {
  kind: string;
  siteId: number | null;
  siteName: string;
  bucket: string;
  dateRange: string;
  figureLabel: string;
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

export function ExecutiveDashboardPage() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [customizing, setCustomizing] = useState(false);
  const [draft, setDraft] = useState<DashboardLayout | null>(null);
  const [drill, setDrill] = useState<DrillRequest | null>(null);

  const dashboard = useQuery({
    queryKey: ["executive"],
    queryFn: async () => (await apiClient.get<DashboardPayload>("/executive")).data,
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

  const records = useQuery({
    queryKey: ["executive-records", drill],
    enabled: drill != null,
    queryFn: async () => {
      const params = new URLSearchParams({
        kind: drill!.kind,
        bucket: drill!.bucket,
        dateRange: drill!.dateRange,
        siteId: drill!.siteId == null ? "unassigned" : String(drill!.siteId),
      });
      return (await apiClient.get<DrillPayload>(`/executive/records?${params.toString()}`)).data;
    },
  });

  const catalog = dashboard.data?.catalog ?? [];
  const catalogByKind = useMemo(() => new Map(catalog.map((item) => [item.kind, item])), [catalog]);

  if (dashboard.isLoading) return <LoadingPlaceholder />;
  if (dashboard.isError || !dashboard.data || !layout) {
    return <p className="text-sm text-destructive">Couldn't load the executive dashboard.</p>;
  }

  const columns = dashboard.data.columns;

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
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-foreground">Executive dashboard</h1>
          <p className="text-sm text-muted-foreground">Greer and Wellman, side by side. Numbers open the matching records.</p>
        </div>
        <div className="flex flex-wrap gap-2">
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
        </div>
      </div>

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
        </div>
      )}

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
                return (
                  <article key={`${column.siteName}-${widget.id}`} className="rounded-lg border border-border bg-card p-3">
                    <div className="mb-2 flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="truncate text-sm font-medium text-foreground" title={live?.title ?? item?.label ?? widget.kind}>
                          {live?.title ?? item?.label ?? widget.kind}
                        </h3>
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
                    <ul className="flex flex-col gap-1">
                      {(live?.figures ?? []).map((figure) => (
                        <li key={`${widget.id}-${figure.bucket}-${figure.label}`}>
                          <button
                            type="button"
                            className="flex w-full items-baseline justify-between gap-2 rounded-md px-1 py-0.5 text-left hover:bg-muted"
                            title={figure.label}
                            onClick={() =>
                              setDrill({
                                kind: widget.kind,
                                siteId: column.siteId,
                                siteName: column.siteName,
                                bucket: figure.bucket,
                                dateRange: live?.dateRange ?? widget.dateRange,
                                figureLabel: figure.label,
                              })
                            }
                          >
                            <span className="truncate text-sm text-muted-foreground">{figure.label}</span>
                            <span className="text-sm font-semibold text-foreground">{figure.value}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </section>
          ))}
        </div>
      )}

      {drill && (
        <section className="rounded-lg border border-border bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-semibold text-foreground" title={`${drill.siteName} · ${drill.figureLabel}`}>
                {drill.siteName} · {drill.figureLabel}
              </h2>
              <p className="text-xs text-muted-foreground">{records.data?.title}</p>
            </div>
            <button type="button" className="text-sm text-muted-foreground hover:text-foreground" onClick={() => setDrill(null)}>
              Close
            </button>
          </div>
          {records.isLoading && <p className="text-sm text-muted-foreground">Loading records…</p>}
          {records.isError && <p className="text-sm text-destructive">Couldn't load those records.</p>}
          {records.data && records.data.rows.length === 0 && <p className="text-sm text-muted-foreground">No records in this count.</p>}
          {records.data && records.data.rows.length > 0 && (
            <ul className="flex flex-col divide-y divide-border">
              {records.data.rows.map((row, index) => {
                const label = `${row.recordNumber} ${row.title}`.trim();
                const body = (
                  <span className="flex min-w-0 flex-1 items-baseline justify-between gap-3">
                    <span className="truncate text-sm text-foreground" title={label}>
                      {row.recordNumber} {row.title}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground" title={`${row.status} · ${row.ageLabel}`}>
                      {row.status} · {row.ageLabel}
                    </span>
                  </span>
                );
                return (
                  <li key={`${row.recordNumber}-${index}`} className="py-2">
                    {row.href ? (
                      <Link to={row.href} className="flex hover:underline">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
