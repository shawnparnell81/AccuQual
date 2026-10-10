export const WIDGET_KINDS = ["open_ncrs", "fai", "complaints", "warranty", "open_capas", "overdue", "audits"] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];

export const DATE_RANGES = ["30d", "90d", "365d", "all"] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export interface DashboardWidget {
  id: string;
  kind: WidgetKind;
  metric: string;
  dateRange: DateRange;
}

export interface DashboardLayout {
  version: 1;
  widgets: DashboardWidget[];
}

export interface MetricChoice {
  id: string;
  label: string;
}

export const DATE_RANGE_CHOICES: { id: DateRange; label: string }[] = [
  { id: "30d", label: "Last 30 days" },
  { id: "90d", label: "Last 90 days" },
  { id: "365d", label: "Last 12 months" },
  { id: "all", label: "All dates" },
];

export const WIDGET_CATALOG: { kind: WidgetKind; label: string; metrics: MetricChoice[] }[] = [
  {
    kind: "open_ncrs",
    label: "Open NCRs",
    metrics: [
      { id: "summary", label: "Count, aging, status, and top category" },
      { id: "count", label: "Open count" },
      { id: "aging", label: "Aging" },
      { id: "status", label: "By status" },
      { id: "category", label: "Top category" },
    ],
  },
  {
    kind: "fai",
    label: "FAI / validation",
    metrics: [
      { id: "summary", label: "Open, pass, and fail" },
      { id: "open", label: "Open" },
      { id: "pass", label: "Pass" },
      { id: "fail", label: "Fail" },
    ],
  },
  {
    kind: "complaints",
    label: "Customer complaints",
    metrics: [
      { id: "summary", label: "Open count and status" },
      { id: "count", label: "Open count" },
      { id: "status", label: "By status" },
    ],
  },
  {
    kind: "warranty",
    label: "Warranty claims",
    metrics: [
      { id: "summary", label: "Open count and status" },
      { id: "count", label: "Open count" },
      { id: "status", label: "By status" },
    ],
  },
  {
    kind: "open_capas",
    label: "Open CAPAs",
    metrics: [
      { id: "summary", label: "Open count and status" },
      { id: "count", label: "Open count" },
      { id: "status", label: "By status" },
    ],
  },
  {
    kind: "overdue",
    label: "Overdue items",
    metrics: [
      { id: "summary", label: "Overdue by record type" },
      { id: "count", label: "Overdue count" },
    ],
  },
  {
    kind: "audits",
    label: "Open audits",
    metrics: [
      { id: "summary", label: "Open count and status" },
      { id: "count", label: "Open count" },
      { id: "status", label: "By status" },
    ],
  },
];

const KIND_SET = new Set<string>(WIDGET_KINDS);
const RANGE_SET = new Set<string>(DATE_RANGES);

/** The layout every executive sees until they save their own. */
export function defaultExecutiveLayout(): DashboardLayout {
  return {
    version: 1,
    widgets: [
      { id: "open_ncrs", kind: "open_ncrs", metric: "summary", dateRange: "90d" },
      { id: "fai", kind: "fai", metric: "summary", dateRange: "90d" },
      { id: "complaints", kind: "complaints", metric: "summary", dateRange: "90d" },
      { id: "warranty", kind: "warranty", metric: "summary", dateRange: "90d" },
      { id: "open_capas", kind: "open_capas", metric: "summary", dateRange: "90d" },
      { id: "overdue", kind: "overdue", metric: "summary", dateRange: "all" },
      { id: "audits", kind: "audits", metric: "summary", dateRange: "90d" },
    ],
  };
}

export function metricAllowed(kind: WidgetKind, metric: string): boolean {
  return WIDGET_CATALOG.find((item) => item.kind === kind)?.metrics.some((choice) => choice.id === metric) ?? false;
}

export function parseLayout(value: unknown): DashboardLayout | null {
  if (!value || typeof value !== "object") return null;
  const record = value as { version?: unknown; widgets?: unknown };
  if (record.version !== 1 || !Array.isArray(record.widgets)) return null;
  const widgets: DashboardWidget[] = [];
  const seen = new Set<string>();
  for (const item of record.widgets) {
    if (!item || typeof item !== "object") return null;
    const row = item as { id?: unknown; kind?: unknown; metric?: unknown; dateRange?: unknown };
    if (typeof row.id !== "string" || typeof row.kind !== "string" || typeof row.metric !== "string" || typeof row.dateRange !== "string") return null;
    const id = row.id.trim().slice(0, 40);
    if (!id || seen.has(id) || !KIND_SET.has(row.kind) || !RANGE_SET.has(row.dateRange)) return null;
    const kind = row.kind as WidgetKind;
    if (!metricAllowed(kind, row.metric)) return null;
    seen.add(id);
    widgets.push({ id, kind, metric: row.metric, dateRange: row.dateRange as DateRange });
  }
  if (widgets.length === 0 || widgets.length > 24) return null;
  return { version: 1, widgets };
}

export function dateRangeLabel(range: DateRange): string {
  return DATE_RANGE_CHOICES.find((choice) => choice.id === range)?.label ?? range;
}

export function widgetLabel(kind: WidgetKind): string {
  return WIDGET_CATALOG.find((item) => item.kind === kind)?.label ?? kind;
}
