/**
 * Standing policy: a Pass/Fail (or equivalent) result is calculated from the
 * requirement and the measured result. Within tolerance is Pass (green).
 * Outside tolerance is Fail (red). The cell stays blank until the math can
 * be decided. A person picks the result only where the form already has a
 * deliberate override, or where the row has no numeric requirement.
 *
 * Grids import this through apps/web/src/lib/passFail.ts. PDF export calls
 * it directly so a print matches the screen. No schema change: the result
 * is written into the row that already stores the readings.
 */

export const PASS_FILL = "#4EA72E";
export const PASS_INK = "#1A1A1A";
export const FAIL_FILL = "#FF0000";
export const FAIL_INK = "#FFFFFF";

export type PassFailWord = "Pass" | "Fail" | "";
export type PassFailFill = "fill-green" | "fill-red" | "";

const EPS = 1e-9;

function isBlank(value: unknown): boolean {
  return value == null || (typeof value === "string" && value.trim() === "");
}

function stripUnit(text: string): string {
  return text.replace(/\s*[a-zA-Z°"'µμ%]+$/u, "").trim();
}

export function parseMeasure(value: string | number | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  let cleaned = value.trim().replace(/,/g, "").replace(/−/g, "-");
  cleaned = stripUnit(cleaned);
  if (!cleaned) return null;
  const numeric = Number(cleaned.replace(/^[±+]/, ""));
  return Number.isFinite(numeric) ? numeric : null;
}

function asMeasure(value: unknown): string | number | null | undefined {
  if (typeof value === "number" || typeof value === "string" || value == null) return value;
  return undefined;
}

/** Bilateral ±, unequal +a/-b, or an absolute low-high pair such as 9.90-10.10. */
export function toleranceBand(nominal: number, toleranceRaw: string | number): { low: number; high: number } | null {
  if (typeof toleranceRaw === "number" && Number.isFinite(toleranceRaw)) {
    const span = Math.abs(toleranceRaw);
    return { low: nominal - span, high: nominal + span };
  }
  if (typeof toleranceRaw !== "string") return null;
  const text = stripUnit(toleranceRaw.trim().replace(/−/g, "-"));
  if (!text) return null;
  const bilateral = text.match(/^(?:±|\+\/-)\s*([0-9]*\.?[0-9]+)$/);
  if (bilateral?.[1]) {
    const span = Number(bilateral[1]);
    return { low: nominal - span, high: nominal + span };
  }
  const unequal = text.match(/^\+\s*([0-9]*\.?[0-9]+)\s*\/\s*-\s*([0-9]*\.?[0-9]+)$/);
  if (unequal?.[1] && unequal[2]) return { low: nominal - Number(unequal[2]), high: nominal + Number(unequal[1]) };
  const range = text.match(/^([0-9]*\.?[0-9]+)\s*-\s*([0-9]*\.?[0-9]+)$/);
  if (range?.[1] && range[2]) return { low: Number(range[1]), high: Number(range[2]) };
  const span = Number(text);
  if (Number.isFinite(span)) return { low: nominal - Math.abs(span), high: nominal + Math.abs(span) };
  return null;
}

function rangeOnly(toleranceRaw: string | number): { low: number; high: number } | null {
  if (typeof toleranceRaw !== "string") return null;
  const text = stripUnit(toleranceRaw.trim().replace(/−/g, "-"));
  const range = text.match(/^([0-9]*\.?[0-9]+)\s*-\s*([0-9]*\.?[0-9]+)$/);
  if (!range?.[1] || !range[2]) return null;
  return { low: Number(range[1]), high: Number(range[2]) };
}

function inBand(actual: number, band: { low: number; high: number }): boolean {
  return actual >= band.low - EPS && actual <= band.high + EPS;
}

/**
 * Pass when the actual reading sits inside nominal ± tolerance.
 * A low-high pair such as 9.5-10.5 does not need a separate nominal.
 * Blank until the reading and the requirement are both filled.
 */
export function faiResult(
  nominalRaw: string | number | null | undefined,
  toleranceRaw: string | number | null | undefined,
  actualRaw: string | number | null | undefined,
): PassFailWord {
  const actual = parseMeasure(actualRaw);
  if (actual == null || toleranceRaw == null || toleranceRaw === "") return "";
  const nominal = parseMeasure(nominalRaw);
  const band = nominal == null ? rangeOnly(toleranceRaw) : toleranceBand(nominal, toleranceRaw);
  if (!band) return "";
  return inBand(actual, band) ? "Pass" : "Fail";
}

export function passFailFill(result: string): PassFailFill {
  const token = result.trim().toLowerCase();
  if (token === "pass" || token === "passed") return "fill-green";
  if (token === "fail" || token === "failed") return "fill-red";
  return "";
}

/** Same name the first-article sheet already calls. */
export const faiFill = passFailFill;

export function passFailPaint(result: string): { bg: string; fg: string } | null {
  const token = result.trim().toLowerCase();
  if (token === "pass" || token === "passed") return { bg: PASS_FILL, fg: PASS_INK };
  if (token === "fail" || token === "failed") return { bg: FAIL_FILL, fg: FAIL_INK };
  return null;
}

function hexToUnit(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/** PDF fill for a computed Pass/Fail cell. Null when the cell is blank. */
export function passFailPdfPalette(value: unknown): { bg: readonly [number, number, number]; fg: readonly [number, number, number] } | null {
  if (typeof value !== "string") return null;
  const paint = passFailPaint(value);
  if (!paint) return null;
  return { bg: hexToUnit(paint.bg), fg: hexToUnit(paint.fg) };
}

/** Split "10 ± 0.05" or "10 +0.10/-0.05" into the nominal and tolerance cells. */
export function splitSpecification(raw: string): { nominal: string; tolerance: string } {
  const text = raw.trim().replace(/−/g, "-").replace(/\s+/g, " ");
  if (!text) return { nominal: "", tolerance: "" };
  const unit = String.raw`(?:\s*[a-zA-Z°"'µμ%]+)?`;
  const bilateral = text.match(new RegExp(String.raw`^([+-]?\d*\.?\d+)\s*(?:±|\+/-)\s*(\d*\.?\d+)${unit}$`, "i"));
  if (bilateral?.[1] && bilateral[2]) return { nominal: bilateral[1], tolerance: `±${bilateral[2]}` };
  const unequal = text.match(new RegExp(String.raw`^([+-]?\d*\.?\d+)\s*\+\s*(\d*\.?\d+)\s*/\s*-\s*(\d*\.?\d+)${unit}$`, "i"));
  if (unequal?.[1] && unequal[2] && unequal[3]) return { nominal: unequal[1], tolerance: `+${unequal[2]}/-${unequal[3]}` };
  const range = text.match(/^(\d*\.?\d+)\s*-\s*(\d*\.?\d+)$/);
  if (range?.[1] && range[2]) return { nominal: "", tolerance: `${range[1]}-${range[2]}` };
  if (/^(?:±|\+\/-|\+)/.test(text)) return { nominal: "", tolerance: stripUnit(text) };
  return { nominal: "", tolerance: text };
}

export interface MeasuredKeys {
  nominal?: string;
  tolerance?: string;
  actual?: string;
  specification?: string;
}

/** Pass/Fail for one grid row. Reads nominal, tolerance, and actual, with the older specification column as a fallback. */
export function rowPassFail(row: Record<string, unknown>, keys: MeasuredKeys = {}): PassFailWord {
  const nominalKey = keys.nominal ?? "nominal";
  const toleranceKey = keys.tolerance ?? "tolerance";
  const actualKey = keys.actual ?? "actual";
  let nominal = row[nominalKey];
  let tolerance = row[toleranceKey];
  let actual = row[actualKey];
  if (isBlank(actual) && actualKey === "actual") actual = row.measurementResults;

  const specKey = keys.specification;
  const spec = specKey ? row[specKey] : row.specificationLimits;
  if ((isBlank(nominal) || isBlank(tolerance)) && !isBlank(spec)) {
    const split = splitSpecification(String(spec));
    if (isBlank(nominal) && split.nominal) nominal = split.nominal;
    if (isBlank(tolerance) && split.tolerance) tolerance = split.tolerance;
  }
  return faiResult(asMeasure(nominal), asMeasure(tolerance), asMeasure(actual));
}

/**
 * Older dimensional rows stored Specification / Limits and Measurement Results
 * and a manual OK / Not OK checkbox. Copy those into Nominal, Tolerance, and
 * Actual once, then drop the old keys so the checkbox cannot override the math.
 * Returns the same row when there is nothing to copy.
 */
export function hydrateDimensionalRow(row: Record<string, unknown>): Record<string, unknown> {
  const hasLegacy = "measurementResults" in row || "specificationLimits" in row || "okNotOk" in row;
  if (!hasLegacy) return row;
  const next: Record<string, unknown> = { ...row };
  if (isBlank(next.actual) && !isBlank(next.measurementResults)) next.actual = String(next.measurementResults);
  if ((isBlank(next.nominal) || isBlank(next.tolerance)) && !isBlank(next.specificationLimits)) {
    const split = splitSpecification(String(next.specificationLimits));
    if (isBlank(next.nominal) && split.nominal) next.nominal = split.nominal;
    if (isBlank(next.tolerance)) next.tolerance = split.tolerance || String(next.specificationLimits);
  }
  delete next.measurementResults;
  delete next.specificationLimits;
  delete next.okNotOk;
  return next;
}

/** Min/max/actual on a quality inspection row. Blank when the row is not numeric, so a visual check can still be chosen by hand. */
export function inspectionItemResult(item: { specMin?: unknown; specMax?: unknown; actualValue?: unknown }): "pass" | "fail" | "" {
  const actual = parseMeasure(asMeasure(item.actualValue));
  const low = parseMeasure(asMeasure(item.specMin));
  const high = parseMeasure(asMeasure(item.specMax));
  if (actual == null || (low == null && high == null)) return "";
  if (low != null && actual < low - EPS) return "fail";
  if (high != null && actual > high + EPS) return "fail";
  return "pass";
}

/** Force the stored inspection result when min/max and the actual value decide it. Otherwise leave the patch alone. */
export function applyMeasuredResult(
  current: { specMin?: unknown; specMax?: unknown; actualValue?: unknown },
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const judged = inspectionItemResult({
    specMin: patch.specMin !== undefined ? patch.specMin : current.specMin,
    specMax: patch.specMax !== undefined ? patch.specMax : current.specMax,
    actualValue: patch.actualValue !== undefined ? patch.actualValue : current.actualValue,
  });
  if (!judged) return patch;
  return { ...patch, result: judged };
}

/** PDF value for a measured Pass/Fail column. The calculated word wins over anything previously stored. */
export function measuredCellValue(formula: string | undefined, row: Record<string, unknown>, stored: unknown): unknown {
  if (formula === "dimensionalPassFail") {
    const word = rowPassFail(hydrateDimensionalRow(row));
    return word || stored;
  }
  if (formula === "characteristicStatus") {
    const word = rowPassFail(row, { actual: "actualResult", specification: "specTolerance" });
    return word || stored;
  }
  return stored;
}
