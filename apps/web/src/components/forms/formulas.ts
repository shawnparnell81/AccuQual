/**
 * Formulas for TableColumn.kind === "computed" cells. Each takes the row it
 * lives in and returns the derived value, which GenericFormRenderer then
 * writes back into that row's data on every edit (and once on load) — so the
 * saved form_data, the exported PDF, and any dashboard reading it all see a
 * plain stored value rather than needing to recompute it themselves.
 *
 * Field-key names here are form-specific by design (formulas are declared
 * per layout, so they always know what their sibling columns are called).
 */

export type FormulaFn = (row: Record<string, unknown>) => unknown;

function num(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

export const FORMULAS: Record<string, FormulaFn> = {
  /** FMEA: R.P.N. = Severity x Occurrence x Detection (initial ratings). */
  rpn: (row) => {
    const s = num(row.severity);
    const o = num(row.occurrence);
    const d = num(row.detection);
    return s && o && d ? s * o * d : "";
  },

  /** FMEA: revised R.P.N. after the recommended action is taken. */
  rpnRevised: (row) => {
    const s = num(row.severityRevised);
    const o = num(row.occurrenceRevised);
    const d = num(row.detectionRevised);
    return s && o && d ? s * o * d : "";
  },

  /** Calibration roster: Next Due = Last Cal Date + Interval (months). */
  nextCalDueDate: (row) => {
    const last = parseDate(row.lastCalDate);
    const months = num(row.intervalMonths);
    if (!last || !months) return "";
    const next = new Date(last);
    next.setMonth(next.getMonth() + months);
    return next.toISOString().slice(0, 10);
  },

  /** Calibration roster: whole days between today and the computed due date (negative = past due). */
  daysUntilDue: (row) => {
    const due = parseDate(row.nextCalDueDate);
    if (!due) return "";
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    due.setHours(0, 0, 0, 0);
    return Math.round((due.getTime() - today.getTime()) / 86400000);
  },

  /**
   * Calibration roster status, color-coded per the user's thresholds:
   * overdue, due within 30 days, due within 60 days, otherwise current.
   * An explicit "Inactive" equipment status overrides all of the above.
   */
  calibrationStatus: (row) => {
    if (String(row.status ?? "").toLowerCase() === "inactive") return "Inactive";
    const daysRaw = row.daysUntilDue;
    if (daysRaw === "" || daysRaw === undefined || daysRaw === null) return "";
    const days = num(daysRaw);
    if (days < 0) return "Past Due";
    if (days <= 30) return "Due Within 30 Days";
    if (days <= 60) return "Due Within 60 Days";
    return "Current";
  },

  /** Production log: yield = actual produced / target, as a percentage rounded to 1 decimal. */
  yieldPercent: (row) => {
    const target = num(row.targetQty);
    const actual = num(row.actualQtyProduced);
    if (!target) return "";
    return Math.round((actual / target) * 1000) / 10;
  },

  /** Production Output Log: Net Yield = Actual Gross Produced - Scrap Quantity. */
  netYield: (row) => {
    const gross = num(row.actualGrossProduced);
    const scrap = num(row.scrapQuantity);
    return gross || scrap ? gross - scrap : "";
  },

  /** Maintenance Work Order: Total Cost = (Estimated Labor Hours x Hourly Labor Rate) + Replacement Parts Cost. */
  maintenanceTotalCost: (row) => {
    const hours = num(row.estimatedLaborHours);
    const rate = num(row.hourlyLaborRate);
    const parts = num(row.replacementPartsCost);
    if (!hours && !rate && !parts) return "";
    return Math.round((hours * rate + parts) * 100) / 100;
  },

  /**
   * Competency matrix: Total Qualification % = sum of the 4 station
   * proficiency levels (0-4 scale each: 0 Not Qualified ... 4 Expert) over
   * the maximum possible (4 stations x level 4), as a percentage.
   */
  competencyQualificationPercent: (row) => {
    const levels = [num(row.station10Level), num(row.station20Level), num(row.station30Level), num(row.station40Level)];
    const max = levels.length * 4;
    const sum = levels.reduce((a, b) => a + b, 0);
    return Math.round((sum / max) * 1000) / 10;
  },

  /**
   * Approved Vendor List: Performance Score from Defect Rate (PPM) and
   * On-Time Delivery (%), per the user's chosen tier rule —
   * Approved: PPM <=25 AND Delivery >=98%. Conditional: PPM <=100 OR Delivery >=95%.
   * Disqualified: worse than that.
   */
  avlPerformanceScore: (row) => {
    const ppm = num(row.defectRatePpm);
    const delivery = num(row.deliveryPerformancePct);
    if (!row.defectRatePpm && !row.deliveryPerformancePct) return "";
    if (ppm <= 25 && delivery >= 98) return "Approved";
    if (ppm <= 100 || delivery >= 95) return "Conditional";
    return "Disqualified";
  },
};

/** Background/text color pairs for known status labels — semantic, not part of a form's chrome palette. */
export const STATUS_COLORS: Record<string, { bg: string; fg: string }> = {
  "Past Due": { bg: "#FBE4E0", fg: "#9A2E20" },
  "Due Within 30 Days": { bg: "#FCE7D6", fg: "#9A5A1E" },
  "Due Within 60 Days": { bg: "#FBF2CE", fg: "#7A6B18" },
  Current: { bg: "#DCF2E7", fg: "#1E7A54" },
  Inactive: { bg: "#EAEAE6", fg: "#66655D" },
  "Never Calibrated": { bg: "#EAEAE6", fg: "#66655D" },
  Approved: { bg: "#DCF2E7", fg: "#1E7A54" },
  Conditional: { bg: "#FBF2CE", fg: "#7A6B18" },
  Disqualified: { bg: "#FBE4E0", fg: "#9A2E20" },
};

/**
 * Same overdue/60-day/30-day thresholds as the `calibrationStatus` formula
 * above, applied directly to a next-due date — used by the Calibration
 * equipment roster (apps/web/src/routes/Calibration/CalibrationPage.tsx),
 * which tracks due dates as a real relation (equipment -> its calibration
 * history) rather than as fields inside one fillable form.
 */
export function calibrationStatusFromDueDate(nextDueAt: string | Date | null | undefined): string {
  const due = parseDate(nextDueAt ?? null);
  if (!due) return "Never Calibrated";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const days = Math.round((due.getTime() - today.getTime()) / 86400000);
  if (days < 0) return "Past Due";
  if (days <= 30) return "Due Within 30 Days";
  if (days <= 60) return "Due Within 60 Days";
  return "Current";
}

/** Runs every kind:"computed" column in a table's column list against one row, in column order (so a later formula can read an earlier column's freshly-computed value). */
export function materializeRow(row: Record<string, unknown>, columns: { key: string; kind: string; formula?: string }[]): Record<string, unknown> {
  let next = row;
  for (const col of columns) {
    const fn = col.kind === "computed" && col.formula ? FORMULAS[col.formula] : undefined;
    if (fn) {
      const value = fn(next);
      if (next[col.key] !== value) next = { ...next, [col.key]: value };
    }
  }
  return next;
}
