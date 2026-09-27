/**
 * Process FMEA Action Priority and R.P.N. bands.
 *
 * Action Priority is the AIAG-VDA FMEA Handbook (1st Edition, 2019) table
 * titled for DFMEA and PFMEA — the PFMEA table. Each published cell is one
 * rule below (severity band, occurrence band, detection band, H/M/L).
 * Severity is weighted first, then occurrence, then detection. This is not
 * the separate FMEA-MSR table.
 *
 * Kept identical in both of these files (no shared package):
 *   apps/web/src/components/forms/fmeaPriority.ts
 *   services/api/src/modules/forms/fmeaPriority.ts
 */

export type ActionPriority = "H" | "M" | "L";

export interface ActionPriorityRule {
  /** Inclusive severity range. */
  severity: readonly [number, number];
  /** Inclusive occurrence range. */
  occurrence: readonly [number, number];
  /** Inclusive detection range. */
  detection: readonly [number, number];
  ap: ActionPriority;
}

function rules(
  severity: readonly [number, number],
  occurrence: readonly [number, number],
  cells: readonly (readonly [number, number, ActionPriority])[],
): ActionPriorityRule[] {
  return cells.map(([d0, d1, ap]) => ({
    severity,
    occurrence,
    detection: [d0, d1] as const,
    ap,
  }));
}

function quad(
  severity: readonly [number, number],
  occurrence: readonly [number, number],
  ap: readonly [ActionPriority, ActionPriority, ActionPriority, ActionPriority],
): ActionPriorityRule[] {
  // Detection bands, handbook order: 7-10, 5-6, 2-4, 1.
  return rules(severity, occurrence, [
    [7, 10, ap[0]],
    [5, 6, ap[1]],
    [2, 4, ap[2]],
    [1, 1, ap[3]],
  ]);
}

/**
 * Full PFMEA Action Priority table, handbook order:
 * severity 9-10, 7-8, 4-6, 2-3, then 1.
 * Within each severity band: occurrence 8-10, 6-7, 4-5, 2-3, then 1.
 * Within each occurrence band: detection 7-10, 5-6, 2-4, then 1.
 */
export const PFMEA_ACTION_PRIORITY_TABLE: readonly ActionPriorityRule[] = [
  // Severity 9-10
  ...quad([9, 10], [8, 10], ["H", "H", "H", "H"]),
  ...quad([9, 10], [6, 7], ["H", "H", "H", "H"]),
  ...quad([9, 10], [4, 5], ["H", "H", "H", "M"]),
  ...quad([9, 10], [2, 3], ["H", "M", "L", "L"]),
  ...rules([9, 10], [1, 1], [[1, 10, "L"]]),

  // Severity 7-8
  ...quad([7, 8], [8, 10], ["H", "H", "H", "H"]),
  ...quad([7, 8], [6, 7], ["H", "H", "H", "M"]),
  ...quad([7, 8], [4, 5], ["H", "M", "M", "M"]),
  ...quad([7, 8], [2, 3], ["M", "M", "L", "L"]),
  ...rules([7, 8], [1, 1], [[1, 10, "L"]]),

  // Severity 4-6
  ...quad([4, 6], [8, 10], ["H", "H", "M", "M"]),
  ...quad([4, 6], [6, 7], ["M", "M", "M", "L"]),
  ...quad([4, 6], [4, 5], ["M", "L", "L", "L"]),
  ...quad([4, 6], [2, 3], ["L", "L", "L", "L"]),
  ...rules([4, 6], [1, 1], [[1, 10, "L"]]),

  // Severity 2-3
  ...quad([2, 3], [8, 10], ["M", "M", "L", "L"]),
  ...quad([2, 3], [6, 7], ["L", "L", "L", "L"]),
  ...quad([2, 3], [4, 5], ["L", "L", "L", "L"]),
  ...quad([2, 3], [2, 3], ["L", "L", "L", "L"]),
  ...rules([2, 3], [1, 1], [[1, 10, "L"]]),

  // Severity 1 — no discernible effect
  ...rules([1, 1], [1, 10], [[1, 10, "L"]]),
];

function inBand(value: number, band: readonly [number, number]): boolean {
  return value >= band[0] && value <= band[1];
}

/** Integer 1-10 as used by the handbook scales, or null when the cell is blank or out of range. */
export function fmeaRating(value: unknown): number | null {
  if (typeof value === "number") {
    if (!Number.isInteger(value) || value < 1 || value > 10) return null;
    return value;
  }
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 1 || n > 10) return null;
    return n;
  }
  return null;
}

/** H, M, or L for a 1-10 severity / occurrence / detection triple. Blank when any rating is missing. */
export function pfmeaActionPriority(severity: unknown, occurrence: unknown, detection: unknown): ActionPriority | "" {
  const s = fmeaRating(severity);
  const o = fmeaRating(occurrence);
  const d = fmeaRating(detection);
  if (s === null || o === null || d === null) return "";
  for (const rule of PFMEA_ACTION_PRIORITY_TABLE) {
    if (inBand(s, rule.severity) && inBand(o, rule.occurrence) && inBand(d, rule.detection)) return rule.ap;
  }
  return "";
}

/**
 * R.P.N. color bands. One place for the form, the quick-entry table, and the PDF.
 * High: 200 and above. Medium: 100-199. Low: below 100.
 */
export const RPN_THRESHOLDS = {
  highMin: 200,
  mediumMin: 100,
} as const;

export type RiskTone = "high" | "medium" | "low";

export function rpnTone(value: unknown): RiskTone | null {
  if (value === "" || value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(String(value).trim());
  if (!Number.isFinite(n)) return null;
  if (n >= RPN_THRESHOLDS.highMin) return "high";
  if (n >= RPN_THRESHOLDS.mediumMin) return "medium";
  return "low";
}

export function apTone(value: unknown): RiskTone | null {
  const letter = String(value ?? "").trim().toUpperCase();
  if (letter === "H") return "high";
  if (letter === "M") return "medium";
  if (letter === "L") return "low";
  return null;
}

/** Theme-token classes. Status hues stay red / amber / green in light, dark, and every color scheme. */
export const FMEA_TONE_CLASS: Record<RiskTone, string> = {
  high: "border-destructive/40 bg-destructive/10 text-destructive",
  medium: "border-warning/40 bg-warning/10 text-warning",
  low: "border-success/40 bg-success/10 text-success",
};

export const FMEA_TONE_NAME: Record<RiskTone, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

/** Light fills for the printed PDF (white page). Same red / amber / green bands. */
export const FMEA_PDF_TONE: Record<RiskTone, { bg: readonly [number, number, number]; fg: readonly [number, number, number] }> = {
  high: { bg: [0.984, 0.894, 0.878], fg: [0.604, 0.18, 0.125] },
  medium: { bg: [0.984, 0.949, 0.808], fg: [0.478, 0.42, 0.094] },
  low: { bg: [0.863, 0.949, 0.906], fg: [0.118, 0.478, 0.329] },
};

const RPN_FORMULAS = new Set(["rpn", "rpnRevised"]);
const AP_FORMULAS = new Set(["actionPriority", "actionPriorityRevised"]);

export function fmeaComputedTone(formula: string | undefined, value: unknown): RiskTone | null {
  if (!formula) return null;
  if (RPN_FORMULAS.has(formula)) return rpnTone(value);
  if (AP_FORMULAS.has(formula)) return apTone(value);
  return null;
}

/**
 * Value to print for a computed FMEA cell. Stored form_data wins. An older
 * saved row has S/O/D and R.P.N. but no AP key yet — derive AP so the PDF
 * still shows it before the form is opened and saved again.
 */
export function fmeaCellValue(formula: string | undefined, row: Record<string, unknown>, stored: unknown): unknown {
  if (stored != null && stored !== "") return stored;
  if (formula === "actionPriority") {
    const ap = pfmeaActionPriority(row.severity, row.occurrence, row.detection);
    return ap || stored;
  }
  if (formula === "actionPriorityRevised") {
    const ap = pfmeaActionPriority(row.severityRevised, row.occurrenceRevised, row.detectionRevised);
    return ap || stored;
  }
  return stored;
}

export const FMEA_PRIORITY_LEGEND =
  "R.P.N.: green below 100 (low), amber 100-199 (medium), red 200 and above (high). AP (Action Priority), AIAG-VDA FMEA Handbook (2019): H high (red), M medium (amber), L low (green).";
