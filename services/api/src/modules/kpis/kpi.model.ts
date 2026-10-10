/**
 * Quality objective catalog, month windows, and status rules.
 * Pure: no database. The live numbers are built in kpi.compute.ts.
 */

export const PLANT_SCOPES = ["greer", "wellman", "all"] as const;
export type PlantScope = (typeof PLANT_SCOPES)[number];

export const DIRECTIONS = ["higher", "lower"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const FREQUENCIES = ["monthly", "quarterly"] as const;
export type ReviewFrequency = (typeof FREQUENCIES)[number];

export const AREAS = ["NCR", "CAPA", "Validation/FAI", "Complaints", "Warranty/Labor", "Audits", "Training", "Calibration", "Suppliers"] as const;
export type KpiArea = (typeof AREAS)[number];

export type KpiUnit = "count" | "percent" | "days" | "currency";

export interface MetricDef {
  id: string;
  area: KpiArea;
  label: string;
  unit: KpiUnit;
  direction: Direction;
  /** False when the source rows have no plant. The page says All plants. */
  plantSplit: boolean;
  /** True when only the current month can be known. Earlier months stay blank. */
  snapshot: boolean;
  definition: string;
}

export const METRICS: MetricDef[] = [
  {
    id: "ncrs_opened",
    area: "NCR",
    label: "NCRs opened",
    unit: "count",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "NCRs created in the month. Deleted NCRs are left out, the same way the dashboards leave them out.",
  },
  {
    id: "ncrs_closed",
    area: "NCR",
    label: "NCRs closed",
    unit: "count",
    direction: "higher",
    plantSplit: true,
    snapshot: false,
    definition: "NCRs whose close time falls in the month.",
  },
  {
    id: "ncr_avg_closure_days",
    area: "NCR",
    label: "Average NCR closure days",
    unit: "days",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "Average days from open to close for NCRs closed in the month. A month with no closures is blank.",
  },
  {
    id: "ncr_closed_within_30",
    area: "NCR",
    label: "NCRs closed within 30 days",
    unit: "percent",
    direction: "higher",
    plantSplit: true,
    snapshot: false,
    definition: "Of the NCRs closed in the month, the share closed within 30 days of being opened.",
  },
  {
    id: "ncr_open_over_30",
    area: "NCR",
    label: "Open NCRs older than 30 days",
    unit: "count",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "NCRs still open at the end of the month (or now, for this month) whose age is more than 30 days. Age uses the same day count as the dashboard.",
  },
  {
    id: "capa_on_time",
    area: "CAPA",
    label: "CAPAs closed on time",
    unit: "percent",
    direction: "higher",
    plantSplit: true,
    snapshot: false,
    definition: "Of the CAPAs closed in the month that have a due date, the share closed on or before that date. A closed CAPA with no due date is left out of the rate and called out in the note.",
  },
  {
    id: "capa_overdue",
    area: "CAPA",
    label: "Overdue CAPAs",
    unit: "count",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "CAPAs still open at the end of the month whose due date has passed. Same rule as the dashboard's late fixes.",
  },
  {
    id: "fai_pass_rate",
    area: "Validation/FAI",
    label: "FAI / validation pass rate",
    unit: "percent",
    direction: "higher",
    plantSplit: true,
    snapshot: false,
    definition: "Pass divided by pass plus fail, for validation reports and first-article ISO forms created in the month. Pass and fail use the executive dashboard rule. In-progress records are not in the rate.",
  },
  {
    id: "complaints",
    area: "Complaints",
    label: "Customer complaints",
    unit: "count",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "Complaint records created in the month: the complaints list, complaint ISO forms, complaint QMS forms, and filed complaint forms. Same sources as the executive dashboard.",
  },
  {
    id: "warranty_count",
    area: "Warranty/Labor",
    label: "Warranty claims",
    unit: "count",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "Warranty claims and warranty forms created in the month. Same sources as the executive dashboard.",
  },
  {
    id: "warranty_cost",
    area: "Warranty/Labor",
    label: "Warranty claims cost",
    unit: "currency",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "Sum of the actual cost on warranty claims created in the month. Warranty forms have no cost, so they are in the count and not in this total.",
  },
  {
    id: "labor_cost",
    area: "Warranty/Labor",
    label: "Labor claims cost",
    unit: "currency",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "Sum of labor-claim cost for claims created in the month.",
  },
  {
    id: "audit_findings",
    area: "Audits",
    label: "Audit findings",
    unit: "count",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "Audit checklist rows recorded in the month that the dashboard counts as findings. Observations are not findings.",
  },
  {
    id: "training_completion",
    area: "Training",
    label: "Training completion",
    unit: "percent",
    direction: "higher",
    plantSplit: true,
    snapshot: true,
    definition: "Completed assignments divided by all assignments, the same rate as the home dashboard. A plant uses people assigned to that plant. Earlier months are not stored.",
  },
  {
    id: "calibration_on_time",
    area: "Calibration",
    label: "Calibration on time",
    unit: "percent",
    direction: "higher",
    plantSplit: false,
    snapshot: true,
    definition: "Gages that are current, upcoming, or due soon, divided by all gages, using the calibration due-status rule. Company-wide: gages are not assigned to a plant. Earlier months are not stored.",
  },
  {
    id: "supplier_ncrs",
    area: "Suppliers",
    label: "Supplier NCRs opened",
    unit: "count",
    direction: "lower",
    plantSplit: true,
    snapshot: false,
    definition: "NCRs created in the month that name a supplier. Deleted NCRs are left out.",
  },
  {
    id: "scars_opened",
    area: "Suppliers",
    label: "SCARs opened",
    unit: "count",
    direction: "lower",
    plantSplit: false,
    snapshot: false,
    definition: "SCAR sheets created in the month. Company-wide: a SCAR sheet is not assigned to a plant.",
  },
];

export const METRIC_IDS = METRICS.map((metric) => metric.id);

/** Opened and closed on one chart. Not itself an objective metric. */
export const NCR_OPENED_CLOSED = "ncr_opened_closed";

export interface ChartDef {
  id: string;
  area: KpiArea;
  label: string;
  metricId: string;
  compareMetricId?: string;
}

export const CHARTS: ChartDef[] = [
  { id: NCR_OPENED_CLOSED, area: "NCR", label: "NCRs opened and closed", metricId: "ncrs_opened", compareMetricId: "ncrs_closed" },
  ...METRICS.map((metric) => ({ id: metric.id, area: metric.area, label: metric.label, metricId: metric.id })),
];

export const CHART_IDS = CHARTS.map((chart) => chart.id);

export const DEFAULT_EXECUTIVE_CHARTS = [NCR_OPENED_CLOSED, "capa_on_time", "fai_pass_rate", "complaints", "warranty_cost"];
export const DEFAULT_HOME_CHARTS: string[] = [];

export function metricById(id: string): MetricDef | undefined {
  return METRICS.find((metric) => metric.id === id);
}

export function chartById(id: string): ChartDef | undefined {
  return CHARTS.find((chart) => chart.id === id);
}

const TZ = "America/New_York";
const DAY_MS = 86_400_000;

export function monthKey(date: Date, timeZone = TZ): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  return `${year}-${month}`;
}

function wallClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const num = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((part) => part.type === type)?.value ?? "0");
  let hour = num("hour");
  if (hour === 24) hour = 0;
  return { year: num("year"), month: num("month"), day: num("day"), hour, minute: num("minute"), second: num("second") };
}

/** Midnight at the start of a calendar day in Eastern time. */
export function easternStart(year: number, month: number, day: number): Date {
  let ms = Date.UTC(year, month - 1, day, 5, 0, 0);
  for (let step = 0; step < 6; step += 1) {
    const wall = wallClock(new Date(ms), TZ);
    const actual = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
    const wanted = Date.UTC(year, month - 1, day, 0, 0, 0);
    if (actual === wanted) return new Date(ms);
    ms -= actual - wanted;
  }
  return new Date(ms);
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const index = year * 12 + (month - 1) + delta;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export interface TimeWindow {
  key: string;
  label: string;
  start: Date;
  end: Date;
  snapshot: Date;
  live: boolean;
}

export function monthWindow(year: number, month: number, now: Date): TimeWindow {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  const start = easternStart(year, month, 1);
  const next = shiftMonth(year, month, 1);
  const end = easternStart(next.year, next.month, 1);
  const live = key === monthKey(now);
  return { key, label: key, start, end, snapshot: live ? now : new Date(end.getTime() - 1), live };
}

export function recentMonthWindows(now: Date, count = 12): TimeWindow[] {
  const [year, month] = monthKey(now).split("-").map(Number) as [number, number];
  const windows: TimeWindow[] = [];
  for (let ago = count - 1; ago >= 0; ago -= 1) {
    const point = shiftMonth(year, month, -ago);
    windows.push(monthWindow(point.year, point.month, now));
  }
  return windows;
}

export function quarterWindow(now: Date): TimeWindow {
  const [year, month] = monthKey(now).split("-").map(Number) as [number, number];
  const quarter = Math.floor((month - 1) / 3) + 1;
  const startMonth = (quarter - 1) * 3 + 1;
  const start = easternStart(year, startMonth, 1);
  const next = shiftMonth(year, startMonth, 3);
  const end = easternStart(next.year, next.month, 1);
  return { key: `${year}-Q${quarter}`, label: `Q${quarter} ${year}`, start, end, snapshot: now, live: true };
}

export function reviewWindow(frequency: ReviewFrequency, now: Date): TimeWindow {
  if (frequency === "quarterly") return quarterWindow(now);
  const [year, month] = monthKey(now).split("-").map(Number) as [number, number];
  return monthWindow(year, month, now);
}

export function inWindow(at: Date | null, window: Pick<TimeWindow, "start" | "end">): boolean {
  if (!at) return false;
  const time = at.getTime();
  return time >= window.start.getTime() && time < window.end.getTime();
}

export function asDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Whole days, matching dashboard.metrics ageDays. */
export function ageDays(at: Date | null, snapshot: Date): number | null {
  if (!at) return null;
  return Math.floor((snapshot.getTime() - at.getTime()) / DAY_MS);
}

export function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export type ObjectiveStatus = "green" | "amber" | "red" | "none";

export function objectiveStatus(actual: number | null, target: number, direction: Direction, amber: number): ObjectiveStatus {
  if (actual == null || Number.isNaN(actual)) return "none";
  if (direction === "higher") {
    if (actual >= target) return "green";
    if (actual >= amber) return "amber";
    return "red";
  }
  if (actual <= target) return "green";
  if (actual <= amber) return "amber";
  return "red";
}

/** How far the actual is toward the target. Lower-is-better uses target / actual. */
export function percentOfTarget(actual: number | null, target: number, direction: Direction): number | null {
  if (actual == null || Number.isNaN(actual)) return null;
  if (direction === "higher") {
    if (target === 0) return actual <= 0 ? 100 : null;
    return round1((actual / target) * 100);
  }
  if (actual <= 0) return 100;
  if (target < 0) return null;
  return round1((target / actual) * 100);
}

export function amberIsValid(direction: Direction, target: number, amber: number): boolean {
  if (!Number.isFinite(target) || !Number.isFinite(amber)) return false;
  return direction === "higher" ? amber <= target : amber >= target;
}

export interface StoredObjective {
  id: string;
  name: string;
  metric: string;
  plantScope: PlantScope;
  target: number;
  direction: Direction;
  amberThreshold: number;
  ownerId: number | null;
  reviewFrequency: ReviewFrequency;
  active: boolean;
  notes: string;
  updatedAt: string;
  updatedById: number | null;
}

export interface SeedOwner {
  id: number;
  name: string | null;
  roleName: string | null;
}

/** Shawn Parnell's admin account when that person exists. Otherwise no owner. */
export function defaultOwnerId(people: SeedOwner[]): number | null {
  const named = people.filter((person) => (person.name ?? "").trim().toLowerCase() === "shawn parnell");
  const admin = named.find((person) => person.roleName === "admin" || person.roleName === "owner");
  return (admin ?? named[0])?.id ?? null;
}

export function seedObjectives(ownerId: number | null, now: Date): StoredObjective[] {
  const stamp = now.toISOString();
  const row = (
    id: string,
    name: string,
    metric: string,
    target: number,
    direction: Direction,
    amberThreshold: number,
    notes: string,
  ): StoredObjective => ({
    id,
    name,
    metric,
    plantScope: "all",
    target,
    direction,
    amberThreshold,
    ownerId,
    reviewFrequency: "monthly",
    active: true,
    notes,
    updatedAt: stamp,
    updatedById: null,
  });
  return [
    row("obj-capa-ontime", "CAPA on time", "capa_on_time", 90, "higher", 80, "Closed on or before the due date."),
    row("obj-ncr-closure", "Average NCR closure", "ncr_avg_closure_days", 30, "lower", 45, "Days from open to close."),
    row("obj-ncr-within-30", "NCRs closed within 30 days", "ncr_closed_within_30", 80, "higher", 70, "Share of closures that took 30 days or less."),
    row("obj-ncr-aged", "Open NCRs older than 30 days", "ncr_open_over_30", 5, "lower", 8, "Still open, and older than 30 days."),
    row("obj-fai-pass", "FAI / validation pass rate", "fai_pass_rate", 95, "higher", 90, "Decided validation reports and first-article forms."),
    row("obj-training", "Training completion", "training_completion", 95, "higher", 90, "Assignments marked completed."),
    row("obj-calibration", "Calibration on time", "calibration_on_time", 98, "higher", 95, "Company-wide. Gages are not assigned to a plant."),
    row("obj-complaints", "Customer complaints", "complaints", 2, "lower", 4, "Complaints opened in the month."),
  ];
}

export function cleanChartOrder(ids: string[] | undefined, fallback: string[]): string[] {
  const known = new Set(CHART_IDS);
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of ids ?? fallback) {
    if (!known.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  return order;
}

export function resolveChartLayout(saved: { home?: string[]; executive?: string[] } | null | undefined): {
  home: string[];
  executive: string[];
  homeIsDefault: boolean;
  executiveIsDefault: boolean;
} {
  const homeIsDefault = !saved || saved.home == null;
  const executiveIsDefault = !saved || saved.executive == null;
  return {
    home: cleanChartOrder(homeIsDefault ? DEFAULT_HOME_CHARTS : saved?.home, DEFAULT_HOME_CHARTS),
    executive: cleanChartOrder(executiveIsDefault ? DEFAULT_EXECUTIVE_CHARTS : saved?.executive, DEFAULT_EXECUTIVE_CHARTS),
    homeIsDefault,
    executiveIsDefault,
  };
}

export function plantToken(name: string): PlantScope | null {
  const folded = name.trim().toLowerCase();
  if (folded === "greer") return "greer";
  if (folded === "wellman") return "wellman";
  return null;
}

/** Dashboard finding rule: an observation is not a finding. A blank row is not one either. */
export function isAuditFinding(severity: string | null, finding: string | null): boolean {
  const folded = (severity ?? "").toLowerCase();
  if (folded === "observation") return false;
  if (folded === "minor" || folded === "major" || folded === "critical") return true;
  return (finding ?? "").trim().length > 0;
}

const ON_TIME_GAGE = new Set(["current", "upcoming", "due_soon"]);

/** Share of gages that are not overdue, failed, or uncalibrated. */
export function calibrationOnTimePercent(statuses: string[]): number | null {
  if (statuses.length === 0) return null;
  const onTime = statuses.filter((status) => ON_TIME_GAGE.has(status)).length;
  return round1((onTime / statuses.length) * 100);
}
