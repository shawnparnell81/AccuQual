/**
 * Turns stored monthly source rows into the report's figures. Every figure comes only from rows dated in its
 * own month. A month with no rows gives null/empty (never another month's numbers).
 */
import type { SourceData, SourceKind } from "./sourceParse.js";
import type { ClaimPoint, FaiCategoryRow, FinancialMonth, MonthMetric, NamedCount, NcrReportRow, ProductAlertSummary, SupplierData, TopPart, TopVehicle, WarrantyMonth } from "./model.js";

export interface StoredSourceRow {
  source: SourceKind | string;
  month: string;
  data: SourceData;
}

/** What the stored files say about a report: trend rows for every window month plus the selected month's detail. */
export interface SourceMonthFigures {
  supplier: SupplierData;
  /** Source kinds that had at least one row in the selected month. */
  kinds: string[];
  /** NCR / CAR / RPN / QTN logged in the selected month (null when that log was never uploaded). */
  logs: { ncr: LogCount | null; car: LogCount | null; rpn: LogCount | null; qtn: LogCount | null };
}

export interface LogCount {
  total: number;
  open: number;
  closed: number;
}

const LINE_NAMES: Record<string, string> = {
  PFP: "Precision Fuel Pump",
};

function text(data: SourceData, key: string): string {
  const value = data[key];
  return value == null ? "" : String(value).trim();
}

function num(data: SourceData, key: string): number | null {
  const value = data[key];
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[$,\s]/g, "");
    if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
    return Number(cleaned);
  }
  return null;
}

function day(data: SourceData, key: string): number | null {
  const value = text(data, key);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)) - 1, Number(value.slice(8, 10))) / 86_400_000;
}

const cents = (value: number) => Math.round(value * 100) / 100;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function isClosed(status: string): boolean {
  return /clos|complete|final|done/i.test(status);
}

function logCount(rows: StoredSourceRow[]): LogCount {
  const closed = rows.filter((row) => isClosed(text(row.data, "status"))).length;
  return { total: rows.length, open: rows.length - closed, closed };
}

function faiOutcome(disposition: string): "passed" | "failed" | "deviation" | null {
  const value = disposition.toLowerCase();
  if (!value || value === "/") return null;
  if (/deviation|concession/.test(value)) return "deviation";
  if (/fail|reject/.test(value)) return "failed";
  if (/pass|approv/.test(value)) return "passed";
  return null;
}

function faiCategoryOf(row: StoredSourceRow): string {
  if (row.source === "fai_csa") return "CSAs & Shocks";
  if (row.source === "fai_fuel") return "Fuel & Lift Supports";
  const type = text(row.data, "part_type").toLowerCase();
  if (/brake|wear|sensor/.test(type)) return "Brake Wear Sensors";
  if (/lift|fuel/.test(type)) return "Fuel & Lift Supports";
  if (/csa|strut|shock/.test(type)) return "CSAs & Shocks";
  return text(row.data, "part_type") || "Other";
}

const FAI_ORDER = ["Fuel & Lift Supports", "CSAs & Shocks", "Brake Wear Sensors"];

/**
 * @param rows every stored row in the window months (the caller loads only those months).
 * @param spans first and last month each source's stored rows cover. Inside that span a month without rows is a
 *   real zero; outside it (or a source never uploaded) the figure is blank, because the files say nothing about it.
 */
export function sourceMonthFigures(rows: StoredSourceRow[], window: string[], selected: string, spans: Map<string, { first: string; last: string }>): SourceMonthFigures {
  const inMonth = (source: string, month: string) => rows.filter((row) => row.source === source && row.month === month);
  // The NCR, CAR, RPN and QTN tabs are one register: a month the register reaches is a real zero on every tab.
  const LOGS = ["ncr", "car", "rpn", "qtn"];
  const logSpans = LOGS.map((kind) => spans.get(kind)).filter((span): span is { first: string; last: string } => span != null);
  const registerSpan = logSpans.length ? { first: logSpans.map((span) => span.first).sort()[0]!, last: logSpans.map((span) => span.last).sort().at(-1)! } : null;
  const covers = (source: string, month: string) => {
    const span = LOGS.includes(source) && spans.has(source) ? registerSpan : spans.get(source);
    return span != null && span.first <= month && month <= span.last;
  };

  const monthlyMetrics: MonthMetric[] = [];
  const financials: FinancialMonth[] = [];
  const warrantyMetrics: WarrantyMonth[] = [];
  for (const month of window) {
    const claims = inMonth("labor_export", month);
    const alerts = inMonth("product_alerts", month);
    if (covers("labor_export", month) || covers("product_alerts", month)) {
      monthlyMetrics.push({ month, totalClaims: covers("labor_export", month) ? claims.length : null, totalProductAlerts: covers("product_alerts", month) ? alerts.length : null });
    }
    if (!covers("labor_export", month)) continue;
    const sum = (key: string) => cents(claims.reduce((total, row) => total + (num(row.data, key) ?? 0), 0));
    const labor = sum("labor_amount_requested");
    const parts = sum("total_amount_of_parts");
    financials.push({ month, totalAmount: sum("total_amount_requested"), partsAmount: parts, laborAmount: labor });
    const lifetimes = claims
      .map((row) => {
        const start = day(row.data, "original_install_date");
        const end = day(row.data, "repair_install_date");
        return start != null && end != null && end >= start ? end - start : null;
      })
      .filter((value): value is number => value != null);
    warrantyMetrics.push({
      month,
      laborToPartsRatio: parts > 0 ? `${(labor / parts).toFixed(2)}:1` : null,
      mttfDays: lifetimes.length ? Math.round((lifetimes.reduce((a, b) => a + b, 0) / lifetimes.length) * 10) / 10 : null,
      medianDays: median(lifetimes),
    });
  }

  const claims = inMonth("labor_export", selected);
  const byDay = new Map<string, number>();
  for (const row of claims) byDay.set(text(row.data, "__date"), (byDay.get(text(row.data, "__date")) ?? 0) + 1);
  const claimsSeries: ClaimPoint[] = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, count]) => ({ date, claims: count, returns: 0 }));

  const partCounts = new Map<string, TopPart>();
  for (const row of claims) {
    const part = text(row.data, "item");
    if (!part) continue;
    const line = text(row.data, "line").toUpperCase();
    const found = partCounts.get(part) ?? { partNumber: part, description: LINE_NAMES[line] ?? line, totalClaims: 0 };
    found.totalClaims += 1;
    partCounts.set(part, found);
  }
  const topParts = [...partCounts.values()].sort((a, b) => b.totalClaims - a.totalClaims || a.partNumber.localeCompare(b.partNumber)).slice(0, 10);

  const vehicleCounts = new Map<string, number>();
  for (const row of claims) {
    const vehicle = [text(row.data, "year"), text(row.data, "make"), text(row.data, "model")].filter(Boolean).join(" ");
    if (vehicle) vehicleCounts.set(vehicle, (vehicleCounts.get(vehicle) ?? 0) + 1);
  }
  const topVehicles: TopVehicle[] = [...vehicleCounts.entries()]
    .sort(([a, x], [b, y]) => y - x || a.localeCompare(b))
    .slice(0, 10)
    .map(([vehicle, count]) => ({ vehicle, claims: count }));

  const executive: Record<string, string> = {};
  const tracker = inMonth("labor_tracker", selected);
  if (covers("labor_export", selected)) executive.raw_claim_count = String(claims.length);
  if (covers("labor_tracker", selected)) {
    const conclusion = (row: StoredSourceRow) => text(row.data, "conclusion").toLowerCase();
    const approved = tracker.filter((row) => conclusion(row).startsWith("approv")).length;
    const denied = tracker.filter((row) => conclusion(row).startsWith("den")).length;
    executive.tracker_processed = String(tracker.length);
    executive.claims_approved = String(approved);
    executive.claims_denied = String(denied);
    const undecided = tracker.length - approved - denied;
    executive.claims_pending = String(Math.max((covers("labor_export", selected) ? claims.length : tracker.length) - tracker.length, 0) + undecided);
  }
  const fuelPumpReturns: NamedCount[] = [];
  if (covers("labor_tracker", selected)) {
    // Fuel pump part numbers (A/B/C/E/M + digits, 43GM...). The tracker's "DMA Part (Y/N)" column splits them.
    const pumps = tracker.filter((row) => /^([ABCEM]\d|43GM)/i.test(text(row.data, "part")));
    const flag = (row: StoredSourceRow) => text(row.data, "dma_part_y_n").toUpperCase();
    fuelPumpReturns.push({ source: "DMA Parts", count: pumps.filter((row) => flag(row).startsWith("Y")).length });
    fuelPumpReturns.push({ source: "Carter / Non-DMA Pumps", count: pumps.filter((row) => flag(row).startsWith("N")).length });
  }

  let productAlerts: ProductAlertSummary | null = null;
  if (covers("product_alerts", selected)) {
    const alerts = inMonth("product_alerts", selected);
    const closed = alerts.filter((row) => /final|clos|complete/i.test(text(row.data, "status")));
    const durations = closed.map((row) => num(row.data, "time_for_completion_days")).filter((value): value is number => value != null);
    productAlerts = {
      total: alerts.length,
      open: alerts.length - closed.length,
      hoursSpent: cents(alerts.reduce((total, row) => total + (num(row.data, "time_spent_investigating_hours") ?? 0), 0)),
      avgDaysToClose: durations.length ? cents(durations.reduce((a, b) => a + b, 0) / durations.length) : null,
    };
  }

  const faiCategories: FaiCategoryRow[] = [];
  const faiKinds = ["fai_fuel", "fai_csa", "fai_sensor"].filter((source) => covers(source, selected));
  if (faiKinds.length > 0) {
    const tally = new Map<string, FaiCategoryRow>();
    for (const category of FAI_ORDER) tally.set(category, { category, totalCompleted: 0, passed: 0, failed: 0, passedWithDeviation: 0 });
    for (const row of rows.filter((item) => item.month === selected && faiKinds.includes(item.source))) {
      const outcome = faiOutcome(text(row.data, row.source === "fai_csa" ? "disposition" : "1st_fai_disposition"));
      const category = faiCategoryOf(row);
      const slot = tally.get(category) ?? { category, totalCompleted: 0, passed: 0, failed: 0, passedWithDeviation: 0 };
      slot.totalCompleted += 1;
      if (outcome === "passed") slot.passed += 1;
      if (outcome === "failed") slot.failed += 1;
      if (outcome === "deviation") slot.passedWithDeviation += 1;
      tally.set(category, slot);
    }
    faiCategories.push(...tally.values());
  }

  const ncrTable: NcrReportRow[] = inMonth("ncr", selected)
    .sort((a, b) => text(a.data, "ncr_number").localeCompare(text(b.data, "ncr_number")))
    .map((row) => ({
      ncrNumber: text(row.data, "ncr_number"),
      partNumber: text(row.data, "part_number"),
      description: text(row.data, "description_of_defect"),
      disposition: text(row.data, "disposition_scrap_rework_use_as_is"),
      status: text(row.data, "status"),
    }));

  const log = (source: string) => (covers(source, selected) ? logCount(inMonth(source, selected)) : null);
  return {
    supplier: {
      monthlyMetrics,
      financials,
      warrantyMetrics,
      claimsSeries,
      topParts,
      topVehicles,
      fuelPumpReturns,
      executive,
      productAlerts,
      faiCategories,
      emailIssues: [],
      notes: [],
      ncrTable,
    },
    kinds: [...new Set(rows.filter((row) => row.month === selected).map((row) => row.source))].sort(),
    logs: { ncr: log("ncr"), car: log("car"), rpn: log("rpn"), qtn: log("qtn") },
  };
}

/**
 * The month's uploaded report keeps every figure it has. Source rows only fill what it left empty, field by field
 * and month by month, and only with that same month's own rows.
 */
export function mergeSourceFigures(supplier: SupplierData, source: SupplierData): SupplierData {
  const fillMonths = <T extends { month: string }>(own: T[], extra: T[], empty: (row: T) => boolean): T[] => {
    const out = own.map((row) => ({ ...row }));
    for (const row of extra) {
      const index = out.findIndex((item) => item.month === row.month);
      if (index < 0) out.push({ ...row });
      else if (empty(out[index]!)) {
        const merged = { ...out[index]! } as Record<string, unknown>;
        for (const [key, value] of Object.entries(row)) if (merged[key] == null || merged[key] === "") merged[key] = value;
        out[index] = merged as T;
      }
    }
    return out;
  };
  const anyBlank = (row: object) => Object.values(row).some((value) => value == null || value === "");
  const executive = { ...supplier.executive };
  for (const [key, value] of Object.entries(source.executive)) if (!executive[key]?.trim()) executive[key] = value;
  const productAlerts =
    supplier.productAlerts && source.productAlerts
      ? {
          total: supplier.productAlerts.total ?? source.productAlerts.total,
          open: supplier.productAlerts.open ?? source.productAlerts.open,
          hoursSpent: supplier.productAlerts.hoursSpent ?? source.productAlerts.hoursSpent,
          avgDaysToClose: supplier.productAlerts.avgDaysToClose ?? source.productAlerts.avgDaysToClose,
        }
      : supplier.productAlerts ?? source.productAlerts;
  const listOr = <T>(own: T[], extra: T[]) => (own.length > 0 ? own : extra);
  return {
    monthlyMetrics: fillMonths(supplier.monthlyMetrics, source.monthlyMetrics, anyBlank),
    financials: fillMonths(supplier.financials, source.financials, anyBlank),
    warrantyMetrics: fillMonths(supplier.warrantyMetrics, source.warrantyMetrics, anyBlank),
    claimsSeries: listOr(supplier.claimsSeries, source.claimsSeries),
    topParts: listOr(supplier.topParts, source.topParts),
    topVehicles: listOr(supplier.topVehicles, source.topVehicles),
    fuelPumpReturns: listOr(supplier.fuelPumpReturns, source.fuelPumpReturns),
    executive,
    productAlerts,
    faiCategories: listOr(supplier.faiCategories, source.faiCategories),
    emailIssues: supplier.emailIssues,
    notes: supplier.notes,
    ncrTable: listOr(supplier.ncrTable, source.ncrTable),
  };
}
