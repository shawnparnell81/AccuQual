/**
 * Turns already-loaded records into 12-month KPI series.
 * Pure. Loaders in kpi.load.ts fill KpiSource. Pass/fail uses faiOutcome
 * from the executive dashboard.
 */

import type { TimeWindow } from "./kpi.model.js";
import { ageDays, calibrationOnTimePercent, inWindow, round1 } from "./kpi.model.js";

export interface KpiNcr {
  id: number;
  siteId: number | null;
  status: string;
  createdAt: Date | null;
  closedAt: Date | null;
  supplierId: number | null;
  recordNumber: string | null;
  title: string;
}

export interface KpiCapa {
  id: number;
  siteId: number | null;
  status: string;
  createdAt: Date | null;
  closedAt: Date | null;
  dueAt: Date | null;
  recordNumber: string | null;
  title: string;
}

export interface KpiEvent {
  id: number;
  siteId: number | null;
  at: Date | null;
  recordNumber: string | null;
  title: string;
  status: string;
  href: string | null;
  module: string | null;
  cost?: number | null;
  outcome?: "open" | "pass" | "fail";
}

export interface KpiAssignment {
  id: number;
  userId: number;
  status: string;
  dueAt: Date | null;
  courseTitle: string | null;
}

export interface KpiSource {
  now: Date;
  ncrs: KpiNcr[];
  capas: KpiCapa[];
  complaints: KpiEvent[];
  warranties: KpiEvent[];
  labor: KpiEvent[];
  findings: KpiEvent[];
  fai: KpiEvent[];
  scars: KpiEvent[];
  assignments: KpiAssignment[];
  userSites: { userId: number; siteId: number }[];
  gageStatuses: string[];
}

export interface DrillRow {
  recordNumber: string;
  title: string;
  status: string;
  ageLabel: string;
  href: string | null;
  module: string | null;
}

export interface MetricValue {
  value: number | null;
  rows: DrillRow[];
  notes: string[];
}

export type PlantPick = number | "all";

function onPlant(siteId: number | null, plant: PlantPick): boolean {
  if (plant === "all") return true;
  return siteId === plant;
}

function ageLabel(at: Date | null, now: Date): string {
  const days = ageDays(at, now);
  if (days == null || days < 0) return "—";
  if (days === 0) return "today";
  if (days === 1) return "1 day";
  return `${days} days`;
}

function rowFromNcr(ncr: KpiNcr, now: Date, status: string): DrillRow {
  return {
    recordNumber: ncr.recordNumber?.trim() || `NCR ${ncr.id}`,
    title: ncr.title || "NCR",
    status,
    ageLabel: ageLabel(ncr.createdAt, now),
    href: `/ncr/${ncr.id}`,
    module: "ncr",
  };
}

function rowFromCapa(capa: KpiCapa, now: Date): DrillRow {
  const text = capa.title?.trim();
  return {
    recordNumber: capa.recordNumber?.trim() || `CAPA ${capa.id}`,
    title: text || "CAPA",
    status: capa.status,
    ageLabel: ageLabel(capa.createdAt, now),
    href: `/capa/${capa.id}`,
    module: "capa",
  };
}

function rowFromEvent(event: KpiEvent, now: Date): DrillRow {
  return {
    recordNumber: event.recordNumber?.trim() || String(event.id),
    title: event.title,
    status: event.status,
    ageLabel: ageLabel(event.at, now),
    href: event.href,
    module: event.module,
  };
}

function closureDays(ncr: KpiNcr): number | null {
  if (!ncr.createdAt || !ncr.closedAt) return null;
  return (ncr.closedAt.getTime() - ncr.createdAt.getTime()) / 86_400_000;
}

function stillOpen(createdAt: Date | null, closedAt: Date | null, status: string, window: TimeWindow): boolean {
  if (createdAt && createdAt.getTime() > window.snapshot.getTime()) return false;
  if (window.live) return status !== "closed";
  if (!createdAt) return false;
  if (closedAt) return closedAt.getTime() > window.snapshot.getTime();
  return status !== "closed";
}

function plantNote(rows: { siteId: number | null }[], plant: PlantPick, noun: string): string[] {
  if (plant === "all") return [];
  const missing = rows.filter((row) => row.siteId == null).length;
  if (missing === 0) return [];
  return [`${missing} ${noun} have no plant and are counted only under All plants.`];
}

function usersAt(source: KpiSource, plant: PlantPick): Set<number> | null {
  if (plant === "all") return null;
  const ids = new Set<number>();
  for (const row of source.userSites) if (row.siteId === plant) ids.add(row.userId);
  return ids;
}

export function valueFor(metricId: string, source: KpiSource, window: TimeWindow, plant: PlantPick): MetricValue {
  const now = source.now;
  if (metricId === "ncrs_opened" || metricId === "supplier_ncrs") {
    const inMonth = source.ncrs.filter((ncr) => (metricId === "supplier_ncrs" ? ncr.supplierId != null : true) && inWindow(ncr.createdAt, window));
    const rows = inMonth.filter((ncr) => onPlant(ncr.siteId, plant));
    return { value: rows.length, rows: rows.map((ncr) => rowFromNcr(ncr, now, ncr.status)), notes: plantNote(inMonth, plant, "NCRs") };
  }
  if (metricId === "ncrs_closed") {
    const inMonth = source.ncrs.filter((ncr) => inWindow(ncr.closedAt, window));
    const rows = inMonth.filter((ncr) => onPlant(ncr.siteId, plant));
    return { value: rows.length, rows: rows.map((ncr) => rowFromNcr(ncr, now, "closed")), notes: plantNote(inMonth, plant, "NCRs") };
  }
  if (metricId === "ncr_avg_closure_days" || metricId === "ncr_closed_within_30") {
    const inMonth = source.ncrs.filter((ncr) => inWindow(ncr.closedAt, window));
    const closed = inMonth.filter((ncr) => onPlant(ncr.siteId, plant));
    const measured = closed.filter((ncr) => closureDays(ncr) != null);
    const notes = plantNote(inMonth, plant, "NCRs");
    if (closed.length > measured.length) notes.push(`${closed.length - measured.length} closed ${closed.length - measured.length === 1 ? "NCR has" : "NCRs have"} no open time, so ${closed.length - measured.length === 1 ? "it is" : "they are"} left out of the average and the 30-day rate.`);
    if (measured.length === 0) return { value: null, rows: [], notes };
    if (metricId === "ncr_avg_closure_days") {
      const avg = measured.reduce((sum, ncr) => sum + (closureDays(ncr) ?? 0), 0) / measured.length;
      return { value: round1(avg), rows: measured.map((ncr) => rowFromNcr(ncr, now, "closed")), notes };
    }
    const within = measured.filter((ncr) => (closureDays(ncr) ?? 99) <= 30);
    return { value: round1((within.length / measured.length) * 100), rows: measured.map((ncr) => rowFromNcr(ncr, now, "closed")), notes };
  }
  if (metricId === "ncr_open_over_30") {
    const open = source.ncrs.filter((ncr) => stillOpen(ncr.createdAt, ncr.closedAt, ncr.status, window) && (ageDays(ncr.createdAt, window.snapshot) ?? 0) > 30);
    const rows = open.filter((ncr) => onPlant(ncr.siteId, plant));
    const unknown = source.ncrs.filter((ncr) => ncr.status === "closed" && !ncr.closedAt && onPlant(ncr.siteId, plant));
    const notes = plantNote(open, plant, "NCRs");
    if (!window.live && unknown.length > 0) notes.push(`${unknown.length} closed ${unknown.length === 1 ? "NCR has" : "NCRs have"} no close time, so earlier months leave ${unknown.length === 1 ? "it" : "them"} out.`);
    return { value: rows.length, rows: rows.map((ncr) => rowFromNcr(ncr, now, ncr.status)), notes };
  }
  if (metricId === "capa_on_time") {
    const inMonth = source.capas.filter((capa) => capa.status === "closed" && inWindow(capa.closedAt, window));
    const closed = inMonth.filter((capa) => onPlant(capa.siteId, plant));
    const dated = closed.filter((capa) => capa.dueAt && capa.closedAt);
    const notes = plantNote(inMonth, plant, "CAPAs");
    const missing = closed.length - dated.length;
    if (missing > 0) notes.push(`${missing} closed ${missing === 1 ? "CAPA has" : "CAPAs have"} no due date and ${missing === 1 ? "is" : "are"} left out of the on-time rate.`);
    if (dated.length === 0) return { value: null, rows: [], notes };
    const onTime = dated.filter((capa) => capa.closedAt!.getTime() <= capa.dueAt!.getTime());
    return { value: round1((onTime.length / dated.length) * 100), rows: dated.map((capa) => rowFromCapa(capa, now)), notes };
  }
  if (metricId === "capa_overdue") {
    const open = source.capas.filter((capa) => {
      if (!capa.dueAt || !stillOpen(capa.createdAt, capa.closedAt, capa.status, window)) return false;
      return Math.floor((capa.dueAt.getTime() - window.snapshot.getTime()) / 86_400_000) < 0;
    });
    const rows = open.filter((capa) => onPlant(capa.siteId, plant));
    return { value: rows.length, rows: rows.map((capa) => rowFromCapa(capa, now)), notes: plantNote(open, plant, "CAPAs") };
  }
  if (metricId === "fai_pass_rate") {
    const inMonth = source.fai.filter((row) => inWindow(row.at, window));
    const rows = inMonth.filter((row) => onPlant(row.siteId, plant));
    const decided = rows.filter((row) => row.outcome === "pass" || row.outcome === "fail");
    const notes = plantNote(inMonth, plant, "reports");
    const open = rows.length - decided.length;
    if (open > 0) notes.push(`${open} ${open === 1 ? "report is" : "reports are"} still in progress and not in the pass rate.`);
    if (decided.length === 0) return { value: null, rows: [], notes };
    const passed = decided.filter((row) => row.outcome === "pass").length;
    return { value: round1((passed / decided.length) * 100), rows: decided.map((row) => rowFromEvent(row, now)), notes };
  }
  if (metricId === "complaints") return countEvents(source.complaints, window, plant, now, "complaints");
  if (metricId === "warranty_count") {
    const result = countEvents(source.warranties, window, plant, now, "warranty records");
    const forms = source.warranties.filter((row) => onPlant(row.siteId, plant) && inWindow(row.at, window) && row.cost == null);
    if (forms.length > 0) result.notes.push("Warranty forms are in the count. Cost is only on warranty claims.");
    return result;
  }
  if (metricId === "warranty_cost") return sumCost(source.warranties.filter((row) => row.cost != null), window, plant, now, "claims");
  if (metricId === "labor_cost") return sumCost(source.labor, window, plant, now, "labor claims");
  if (metricId === "audit_findings") return countEvents(source.findings, window, plant, now, "findings");
  if (metricId === "scars_opened") {
    const result = countEvents(source.scars, window, "all", now, "SCARs");
    result.notes.unshift("Company-wide. SCAR sheets are not assigned to a plant.");
    return result;
  }
  if (metricId === "training_completion") {
    if (!window.live) return { value: null, rows: [], notes: ["Training completion is the rate today. Earlier months are not stored."] };
    const people = usersAt(source, plant);
    const rows = source.assignments.filter((row) => (people ? people.has(row.userId) : true));
    if (rows.length === 0) return { value: null, rows: [], notes: [] };
    const completed = rows.filter((row) => row.status === "completed");
    return {
      value: round1((completed.length / rows.length) * 100),
      rows: rows.map((row) => ({
        recordNumber: `Assignment ${row.id}`,
        title: row.courseTitle?.trim() || "Training assignment",
        status: row.status,
        ageLabel: ageLabel(row.dueAt, now),
        href: "/training",
        module: "training",
      })),
      notes: ["This is today's completion rate. Earlier months are not stored."],
    };
  }
  if (metricId === "calibration_on_time") {
    const notes = ["Company-wide. Gages are not assigned to a plant, so Greer and Wellman show this same figure."];
    if (!window.live) return { value: null, rows: [], notes: [...notes, "Earlier months are not stored."] };
    return { value: calibrationOnTimePercent(source.gageStatuses), rows: [], notes };
  }
  return { value: null, rows: [], notes: [] };
}

function countEvents(events: KpiEvent[], window: TimeWindow, plant: PlantPick, now: Date, noun: string): MetricValue {
  const rows = events.filter((event) => onPlant(event.siteId, plant) && inWindow(event.at, window));
  const notes: string[] = [];
  if (plant !== "all") {
    const missing = events.filter((event) => event.siteId == null && inWindow(event.at, window)).length;
    if (missing > 0) notes.push(`${missing} ${noun} have no plant and are counted only under All plants.`);
  }
  return { value: rows.length, rows: rows.map((event) => rowFromEvent(event, now)), notes };
}

function sumCost(events: KpiEvent[], window: TimeWindow, plant: PlantPick, now: Date, noun: string): MetricValue {
  const rows = events.filter((event) => onPlant(event.siteId, plant) && inWindow(event.at, window));
  const notes: string[] = [];
  if (plant !== "all") {
    const missing = events.filter((event) => event.siteId == null && inWindow(event.at, window)).length;
    if (missing > 0) notes.push(`${missing} ${noun} have no plant and their cost is counted only under All plants.`);
  }
  const total = rows.reduce((sum, event) => sum + (Number(event.cost) || 0), 0);
  return { value: round1(total), rows: rows.map((event) => rowFromEvent(event, now)), notes };
}

export function countUnsited(events: { siteId: number | null; at: Date | null }[], windows: TimeWindow[]): number {
  return events.filter((event) => event.siteId == null && windows.some((window) => inWindow(event.at, window))).length;
}

export interface SeriesPoint {
  month: string;
  value: number | null;
}

export interface BuiltMetric {
  id: string;
  points: { month: string; all: number | null; byPlant: Record<string, number | null> }[];
  note: string | null;
}

export function seriesFor(metricId: string, source: KpiSource, windows: TimeWindow[], plantIds: number[]): BuiltMetric {
  const notes = new Set<string>();
  const points = windows.map((window) => {
    const all = valueFor(metricId, source, window, "all");
    for (const note of all.notes) notes.add(note);
    const byPlant: Record<string, number | null> = {};
    for (const id of plantIds) {
      const plant = valueFor(metricId, source, window, id);
      byPlant[String(id)] = plant.value;
      for (const note of plant.notes) notes.add(note);
    }
    return { month: window.key, all: all.value, byPlant };
  });
  const text = [...notes].filter(Boolean);
  return { id: metricId, points, note: text.length > 0 ? text.join(" ") : null };
}

