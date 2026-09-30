/** Calculations for the quality and engineering sheets. */

import { parseMeasure } from "./passFail";

export type TrafficFill = "fill-green" | "fill-yellow" | "fill-red" | "fill-gray" | "";

export { faiFill, faiResult, parseMeasure, toleranceBand } from "./passFail";

/** Closing date on a quality alert is 30 days after the issue date. */
export function plusDays(isoDate: string, days: number): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) return null;
  const [year, month, day] = isoDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Achievement for a lower-is-better metric (PPM, NCT, freight, warranty).
 * Customer rows follow IF(actual>target, target/actual, 100%).
 * The scorecard's global NCT row follows IF(actual>target, actual/target, 100%).
 * Returns a ratio (1 = 100%).
 */
export function lowerIsBetter(actual: number | null, target: number | null, mode: "customer" | "global-nct" = "customer"): number | null {
  if (actual == null || target == null) return null;
  if (actual <= target) return 1;
  if (mode === "global-nct") return target === 0 ? null : actual / target;
  return actual === 0 ? null : target / actual;
}

export function lowerBetterFill(actual: number | null, target: number | null): TrafficFill {
  if (actual == null || target == null) return "";
  if (actual <= target) return "fill-green";
  if (target === 0 || actual > target * 1.25) return "fill-red";
  return "fill-yellow";
}

export function higherBetterFill(actual: number | null, target: number | null): TrafficFill {
  if (actual == null || target == null) return "";
  if (actual >= target) return "fill-green";
  if (target === 0) return "";
  if (actual >= target * 0.9) return "fill-yellow";
  return "fill-red";
}

export function vocFill(value: string): TrafficFill {
  const token = value.trim().toUpperCase();
  if (token === "G" || token === "GREEN") return "fill-green";
  if (token === "Y" || token === "YELLOW") return "fill-yellow";
  if (token === "R" || token === "RED") return "fill-red";
  return "";
}

export function nbhFill(value: string): TrafficFill {
  const token = value.trim().toUpperCase();
  if (token === "N" || token === "NO") return "fill-green";
  if (token === "Y" || token === "YES") return "fill-red";
  return "";
}

export function pcaFill(value: string): TrafficFill {
  return value.trim().toLowerCase() === "yes" ? "fill-gray" : "";
}

export function sumNumbers(values: Array<string | number | null | undefined>): number | null {
  let total = 0;
  let any = false;
  for (const value of values) {
    const parsed = parseMeasure(value);
    if (parsed == null) continue;
    total += parsed;
    any = true;
  }
  return any ? total : null;
}

export function formatRatio(ratio: number | null): string {
  if (ratio == null || !Number.isFinite(ratio)) return "";
  return `${Math.round(ratio * 100)}%`;
}

export function formatCount(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "";
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export interface FaiLine {
  balloon: string;
  characteristic: string;
  nominal: string;
  tolerance: string;
  actual: string;
  /** Calculated from nominal, tolerance, and actual. Blank until those three are filled. */
  result?: string;
}

export interface ScorecardRow {
  group: string;
  name: string;
  voc: string;
  nbh: string;
  /** Global target row uses the sheet's NCT formula. Every other row uses the customer formula. */
  band: "global" | "customer";
  ppmMonth: string;
  ppmYtd: string;
  ppmTarget: string;
  ppmPrior: string;
  ppmPctTarget: string;
  nctMonth: string;
  nctYtd: string;
  nctTarget: string;
  nctQty: string;
  nctPctTarget: string;
  otdMonth: string;
  otdTarget: string;
  otdPrior: string;
  otdPctTarget: string;
  otdYear: string;
  freightMonth: string;
  freightYtd: string;
  freightTarget: string;
  warrantyMonth: string;
  warrantyYtd: string;
  warrantyTarget: string;
  volume: string;
}

export interface FailureRow {
  claimed: string;
  op: string;
  problem: string;
  pca: string;
  months: string[];
}

export const FAILURE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const PCA_OPTIONS = ["", "Yes", "No", "N/A", "Not implemented"];
export const VOC_OPTIONS = ["", "G", "Y", "R"];
export const NBH_OPTIONS = ["", "Y", "N"];

export function blankFaiLine(): FaiLine {
  return { balloon: "", characteristic: "", nominal: "", tolerance: "", actual: "" };
}

export function blankScorecardRow(band: "global" | "customer" = "customer"): ScorecardRow {
  return {
    group: "",
    name: "",
    voc: "",
    nbh: "",
    band,
    ppmMonth: "",
    ppmYtd: "",
    ppmTarget: "",
    ppmPrior: "",
    ppmPctTarget: "",
    nctMonth: "",
    nctYtd: "",
    nctTarget: "",
    nctQty: "",
    nctPctTarget: "",
    otdMonth: "",
    otdTarget: "",
    otdPrior: "",
    otdPctTarget: "",
    otdYear: "",
    freightMonth: "",
    freightYtd: "",
    freightTarget: "",
    warrantyMonth: "",
    warrantyYtd: "",
    warrantyTarget: "",
    volume: "",
  };
}

export function blankFailureRow(monthCount: number): FailureRow {
  return { claimed: "", op: "", problem: "", pca: "", months: Array.from({ length: monthCount }, () => "") };
}

export function scorecardAchievement(row: ScorecardRow, metric: "ppm" | "nct"): number | null {
  if (metric === "ppm") return lowerIsBetter(parseMeasure(row.ppmYtd), parseMeasure(row.ppmTarget));
  const mode = row.band === "global" ? "global-nct" : "customer";
  return lowerIsBetter(parseMeasure(row.nctYtd), parseMeasure(row.nctTarget), mode);
}

export function failureRowTotal(row: FailureRow): number | null {
  return sumNumbers(row.months);
}

export function failureColumnTotals(rows: FailureRow[], monthCount: number): Array<number | null> {
  return Array.from({ length: monthCount }, (_, index) => sumNumbers(rows.map((row) => row.months[index] ?? "")));
}

export function topFailureProblems(rows: FailureRow[], count = 5): Array<{ problem: string; total: number }> {
  return rows
    .map((row) => ({ problem: row.problem.trim() || "(untitled)", total: failureRowTotal(row) ?? 0 }))
    .filter((row) => row.total > 0 && row.problem !== "(untitled)")
    .sort((a, b) => b.total - a.total)
    .slice(0, count);
}
