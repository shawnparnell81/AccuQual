/**
 * Monthly dollars come from AccuQual Labor Claims and Warranty claims.
 * A month with no dollar rows stays blank so the company can type it.
 */

export interface ClaimBookMonth {
  month: string;
  count: number;
  hours: number;
  /** Null when no row in the month has a dollar amount. */
  cost: number | null;
}

export type BookGate =
  | { status: "ok"; months: ClaimBookMonth[] }
  | { status: "no_access" }
  | { status: "unavailable"; reason?: string };

export interface FinancialEntry {
  month: string;
  laborAmount: string;
  warrantyAmount: string;
  totalAmount: string;
}

export type MoneySource = "labor_claims" | "warranty" | "entered" | "combined" | "empty" | "no_access";

export interface MoneyLine {
  value: number | null;
  source: MoneySource;
  editable: boolean;
}

export function emptyFinancialEntry(month: string): FinancialEntry {
  return { month, laborAmount: "", warrantyAmount: "", totalAmount: "" };
}

export function parseEnteredAmount(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const cleaned = raw.replace(/[$,]/g, "").trim();
  if (!cleaned || cleaned === "—" || cleaned === "-") return null;
  const value = Number(cleaned);
  if (!Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function monthBook(gate: BookGate, month: string): ClaimBookMonth | null {
  if (gate.status !== "ok") return null;
  return gate.months.find((row) => row.month === month) ?? null;
}

function lineFrom(auto: number | null, entered: number | null, source: "labor_claims" | "warranty", blocked: boolean): MoneyLine {
  if (blocked && auto == null) return { value: entered, source: entered == null ? "no_access" : "entered", editable: false };
  if (auto != null) return { value: auto, source, editable: false };
  if (entered != null) return { value: entered, source: "entered", editable: true };
  return { value: null, source: "empty", editable: true };
}

export function resolveMonthMoney(input: {
  month: string;
  labor: BookGate;
  warranty: BookGate;
  entry?: FinancialEntry;
}): { labor: MoneyLine; warranty: MoneyLine; total: MoneyLine } {
  const laborBook = monthBook(input.labor, input.month);
  const warrantyBook = monthBook(input.warranty, input.month);
  const labor = lineFrom(laborBook?.cost ?? null, parseEnteredAmount(input.entry?.laborAmount), "labor_claims", input.labor.status === "no_access");
  const warranty = lineFrom(warrantyBook?.cost ?? null, parseEnteredAmount(input.entry?.warrantyAmount), "warranty", input.warranty.status === "no_access");
  if (labor.value != null && warranty.value != null) {
    const bothAuto = labor.source !== "entered" && warranty.source !== "entered";
    return { labor, warranty, total: { value: round2(labor.value + warranty.value), source: bothAuto ? "combined" : "entered", editable: false } };
  }
  if (labor.value != null || warranty.value != null) {
    const known = labor.value ?? warranty.value ?? 0;
    const source = labor.value != null ? labor.source : warranty.source;
    return { labor, warranty, total: { value: round2(known), source, editable: false } };
  }
  const typedTotal = parseEnteredAmount(input.entry?.totalAmount);
  if (input.labor.status === "no_access" && input.warranty.status === "no_access") {
    return { labor, warranty, total: { value: typedTotal, source: typedTotal == null ? "no_access" : "entered", editable: false } };
  }
  return { labor, warranty, total: { value: typedTotal, source: typedTotal == null ? "empty" : "entered", editable: true } };
}

export function financialSourceLabel(source: MoneySource): string {
  if (source === "labor_claims") return "Labor Claims";
  if (source === "warranty") return "Warranty claims";
  if (source === "combined") return "Labor Claims + Warranty";
  if (source === "entered") return "Entered";
  if (source === "no_access") return "No access";
  return "";
}

export function normalizeFinancialEntries(value: unknown): FinancialEntry[] {
  if (!Array.isArray(value)) return [];
  const out: FinancialEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const month = typeof row.month === "string" ? row.month.trim() : "";
    if (!/^\d{4}-\d{2}$/.test(month)) continue;
    const text = (key: string) => (typeof row[key] === "string" ? (row[key] as string).slice(0, 40) : "");
    out.push({ month, laborAmount: text("laborAmount"), warrantyAmount: text("warrantyAmount"), totalAmount: text("totalAmount") });
    if (out.length >= 24) break;
  }
  return out;
}
