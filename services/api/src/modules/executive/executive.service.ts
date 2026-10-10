import { sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { AppError } from "../../utils/appError.js";
import { optionalRows } from "../sites/optionalSql.js";
import { loadFacts, type Fact } from "./executive.data.js";
import {
  DATE_RANGE_CHOICES,
  WIDGET_CATALOG,
  type DashboardLayout,
  type DashboardWidget,
  type DateRange,
  type WidgetKind,
  dateRangeLabel,
  defaultExecutiveLayout,
  parseLayout,
  widgetLabel,
} from "./executive.model.js";

export interface SiteColumn {
  siteId: number | null;
  siteName: string;
}

export interface Figure {
  label: string;
  value: number;
  bucket: string;
}

const DAY_MS = 86_400_000;

function rangeStart(range: DateRange, now: Date): number | null {
  if (range === "all") return null;
  const days = range === "30d" ? 30 : range === "90d" ? 90 : 365;
  return now.getTime() - days * DAY_MS;
}

function inWindow(when: Date | null, range: DateRange, now: Date): boolean {
  const start = rangeStart(range, now);
  if (start == null) return true;
  if (!when) return false;
  return when.getTime() >= start;
}

function ageKey(fact: Fact, now: Date): string {
  if (!fact.createdAt) return "unknown";
  const days = Math.floor((now.getTime() - fact.createdAt.getTime()) / DAY_MS);
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  if (days <= 90) return "31-90";
  return "90+";
}

function siteRank(name: string): number {
  const folded = name.trim().toLowerCase();
  if (folded === "greer") return 0;
  if (folded === "wellman") return 1;
  return 2;
}

export function dashboardColumns(sites: { id: number; name: string }[], facts: Fact[], includeUnassigned: boolean): SiteColumn[] {
  const columns: SiteColumn[] = [...sites]
    .sort((a, b) => siteRank(a.name) - siteRank(b.name) || a.name.localeCompare(b.name))
    .map((site) => ({ siteId: site.id, siteName: site.name }));
  if (includeUnassigned && facts.some((fact) => fact.siteId == null)) columns.push({ siteId: null, siteName: "Unassigned" });
  return columns;
}

function onSite(fact: Fact, siteId: number | null): boolean {
  return siteId == null ? fact.siteId == null : fact.siteId === siteId;
}

function groupFor(kind: WidgetKind): Fact["group"] | "overdue" {
  if (kind === "open_ncrs") return "ncr";
  if (kind === "open_capas") return "capa";
  if (kind === "audits") return "audit";
  if (kind === "complaints") return "complaint";
  if (kind === "warranty") return "warranty";
  if (kind === "fai") return "fai";
  return "overdue";
}

function selected(facts: Fact[], widget: DashboardWidget, siteId: number | null, now: Date): Fact[] {
  return facts.filter((fact) => {
    if (!onSite(fact, siteId)) return false;
    if (widget.kind === "overdue") {
      if (!fact.overdue) return false;
      return inWindow(fact.dueAt, widget.dateRange, now);
    }
    if (fact.group !== groupFor(widget.kind)) return false;
    if (widget.kind !== "fai" && fact.outcome !== "open") return false;
    return inWindow(fact.createdAt, widget.dateRange, now);
  });
}

function countFigures(rows: Fact[], bucket: string, label: string): Figure[] {
  return [{ label, value: rows.length, bucket }];
}

function statusFigures(rows: Fact[]): Figure[] {
  const counts = new Map<string, { label: string; value: number }>();
  for (const row of rows) {
    const current = counts.get(row.status) ?? { label: row.statusLabel, value: 0 };
    current.value += 1;
    counts.set(row.status, current);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1].value - a[1].value || a[1].label.localeCompare(b[1].label))
    .map(([status, row]) => ({ label: row.label, value: row.value, bucket: `status:${status}` }));
}

function agingFigures(rows: Fact[], now: Date): Figure[] {
  const order = ["0-7", "8-30", "31-90", "90+"] as const;
  const labels: Record<string, string> = { "0-7": "0–7 days", "8-30": "8–30 days", "31-90": "31–90 days", "90+": "Over 90 days" };
  return order.map((key) => ({
    label: labels[key]!,
    value: rows.filter((row) => ageKey(row, now) === key).length,
    bucket: `age:${key}`,
  }));
}

function categoryFigures(rows: Fact[]): Figure[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const names = row.categories.length > 0 ? row.categories : [];
    for (const name of names) counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 3);
  if (top.length === 0) return [{ label: "No category recorded", value: rows.length, bucket: "category:" }];
  return top.map(([name, value]) => ({ label: name, value, bucket: `category:${encodeURIComponent(name)}` }));
}

function outcomeFigures(rows: Fact[]): Figure[] {
  return [
    { label: "Open", value: rows.filter((row) => row.outcome === "open").length, bucket: "open" },
    { label: "Pass", value: rows.filter((row) => row.outcome === "pass").length, bucket: "pass" },
    { label: "Fail", value: rows.filter((row) => row.outcome === "fail").length, bucket: "fail" },
  ];
}

function overdueFigures(rows: Fact[]): Figure[] {
  const labels: Record<Fact["group"], string> = {
    ncr: "NCRs",
    capa: "CAPAs",
    audit: "Audits",
    complaint: "Complaints",
    warranty: "Warranty",
    fai: "FAI",
    labor: "Labor claims",
    eightd: "8D",
  };
  return (["ncr", "capa", "audit"] as const).map((group) => ({
    label: labels[group],
    value: rows.filter((row) => row.group === group).length,
    bucket: `type:${group}`,
  }));
}

export function figuresFor(widget: DashboardWidget, rows: Fact[], now: Date): Figure[] {
  const metric = widget.metric;
  if (widget.kind === "fai") {
    const all = outcomeFigures(rows);
    if (metric === "summary") return all;
    return all.filter((figure) => figure.bucket === metric);
  }
  if (widget.kind === "overdue") {
    if (metric === "count") return countFigures(rows, "overdue", "Overdue");
    return [{ label: "Overdue", value: rows.length, bucket: "overdue" }, ...overdueFigures(rows)];
  }
  const open = rows.filter((row) => row.outcome === "open");
  if (metric === "count") return countFigures(open, "open", "Open");
  if (metric === "aging" && widget.kind === "open_ncrs") return agingFigures(open, now);
  if (metric === "status") return statusFigures(open);
  if (metric === "category") return categoryFigures(open);
  const summary: Figure[] = countFigures(open, "open", "Open");
  if (widget.kind === "open_ncrs") summary.push(...agingFigures(open, now), ...statusFigures(open), ...categoryFigures(open));
  else summary.push(...statusFigures(open));
  return summary;
}

/** Extra counts that sit on a summary card but are not that card's main record type. */
export function supplementFigures(widget: DashboardWidget, figures: Figure[], facts: Fact[], siteId: number | null, now: Date): Figure[] {
  if (widget.metric !== "summary") return figures;
  if (widget.kind === "warranty") {
    const labor = facts.filter((fact) => fact.group === "labor" && onSite(fact, siteId) && fact.outcome === "open" && inWindow(fact.createdAt, widget.dateRange, now));
    return [...figures, { label: "Labor claims", value: labor.length, bucket: "labor" }];
  }
  if (widget.kind === "open_ncrs") {
    const reports = facts.filter((fact) => fact.group === "eightd" && onSite(fact, siteId) && fact.outcome === "open" && inWindow(fact.createdAt, widget.dateRange, now));
    return [...figures, { label: "8D", value: reports.length, bucket: "eightd" }];
  }
  return figures;
}

export function matchesBucket(fact: Fact, bucket: string, now: Date): boolean {
  if (bucket === "open" || bucket === "count") return fact.outcome === "open";
  if (bucket === "pass" || bucket === "fail") return fact.outcome === bucket;
  if (bucket === "overdue") return fact.overdue;
  if (bucket.startsWith("status:")) return fact.status === bucket.slice("status:".length);
  if (bucket.startsWith("age:")) return ageKey(fact, now) === bucket.slice("age:".length);
  if (bucket.startsWith("type:")) return fact.group === bucket.slice("type:".length);
  if (bucket.startsWith("category:")) {
    const name = decodeURIComponent(bucket.slice("category:".length));
    if (!name) return fact.categories.length === 0;
    return fact.categories.includes(name);
  }
  return false;
}

function showNumber(value: string | null): string {
  return value && value.trim() ? value.trim() : "—";
}

export async function loadSavedLayout(db: Db, userId: number): Promise<{ layout: DashboardLayout; customized: boolean }> {
  const rows = await optionalRows<{ layout: unknown }>(db, sql`SELECT layout FROM executive_dashboard_layouts WHERE user_id = ${userId}`);
  if (rows == null || rows.length === 0) return { layout: defaultExecutiveLayout(), customized: false };
  return { layout: parseLayout(rows[0]?.layout) ?? defaultExecutiveLayout(), customized: parseLayout(rows[0]?.layout) != null };
}

export async function saveLayout(db: Db, userId: number, layout: DashboardLayout): Promise<void> {
  const payload = JSON.stringify(layout);
  const rows = await optionalRows(
    db,
    sql`
      INSERT INTO executive_dashboard_layouts (user_id, layout, updated_at)
      VALUES (${userId}, ${payload}::jsonb, now())
      ON CONFLICT (user_id) DO UPDATE SET layout = EXCLUDED.layout, updated_at = now()
      RETURNING user_id
    `,
  );
  if (rows == null) throw new AppError("The executive dashboard can't be saved until the database update runs.", 503);
}

export async function resetLayout(db: Db, userId: number): Promise<void> {
  const rows = await optionalRows(db, sql`DELETE FROM executive_dashboard_layouts WHERE user_id = ${userId} RETURNING user_id`);
  if (rows == null) throw new AppError("The executive dashboard can't be reset until the database update runs.", 503);
}

export async function buildDashboard(db: Db, userId: number, sites: { id: number; name: string }[], includeUnassigned: boolean) {
  const now = new Date();
  const saved = await loadSavedLayout(db, userId);
  const facts = await loadFacts(db, now);
  const allowed = new Set(sites.map((site) => site.id));
  const visible = facts.filter((fact) => (fact.siteId != null && allowed.has(fact.siteId)) || (fact.siteId == null && includeUnassigned));
  const columns = dashboardColumns(sites, visible, includeUnassigned);
  return {
    customized: saved.customized,
    layout: saved.layout,
    catalog: WIDGET_CATALOG.map((item) => ({ ...item, dateRanges: DATE_RANGE_CHOICES })),
    columns: columns.map((column) => ({
      siteId: column.siteId,
      siteName: column.siteName,
      widgets: saved.layout.widgets.map((widget) => ({
        id: widget.id,
        kind: widget.kind,
        title: widgetLabel(widget.kind),
        metric: widget.metric,
        dateRange: widget.dateRange,
        dateRangeLabel: dateRangeLabel(widget.dateRange),
        figures: supplementFigures(widget, figuresFor(widget, selected(visible, widget, column.siteId, now), now), visible, column.siteId, now),
      })),
    })),
  };
}

export async function drillRecords(
  db: Db,
  sites: { id: number; name: string }[],
  includeUnassigned: boolean,
  input: { kind: WidgetKind; siteId: number | null; bucket: string; dateRange: DateRange },
) {
  const now = new Date();
  const facts = await loadFacts(db, now);
  const allowed = new Set(sites.map((site) => site.id));
  const widget: DashboardWidget = { id: "drill", kind: input.kind, metric: "summary", dateRange: input.dateRange };
  const names = new Map(sites.map((site) => [site.id, site.name]));
  const rows = facts.filter((fact) => {
    const onThisSite = input.siteId == null ? fact.siteId == null : fact.siteId === input.siteId;
    if (!onThisSite) return false;
    if (fact.siteId != null && !allowed.has(fact.siteId)) return false;
    if (fact.siteId == null && !includeUnassigned) return false;
    if (input.bucket === "labor") return fact.group === "labor" && fact.outcome === "open" && inWindow(fact.createdAt, input.dateRange, now);
    if (input.bucket === "eightd") return fact.group === "eightd" && fact.outcome === "open" && inWindow(fact.createdAt, input.dateRange, now);
    return selected([fact], widget, input.siteId, now).length === 1 && matchesBucket(fact, input.bucket, now);
  });
  const listed = rows.slice(0, 1000);
  return {
    title: widgetLabel(input.kind),
    siteName: input.siteId == null ? "Unassigned" : names.get(input.siteId) ?? "Unassigned",
    total: rows.length,
    rows: listed.map((fact) => ({
      recordNumber: showNumber(fact.recordNumber),
      title: fact.title,
      status: fact.statusLabel,
      ageLabel: fact.createdAt ? `${Math.max(0, Math.floor((now.getTime() - fact.createdAt.getTime()) / DAY_MS))} days` : "—",
      href: fact.href,
      module: fact.module,
    })),
  };
}
