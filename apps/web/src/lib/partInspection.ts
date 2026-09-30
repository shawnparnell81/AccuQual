/**
 * Fuel Injector (FRM-VAL-008 sheet) and Brake Wear Sensor (FRM-VAL-009 sheet).
 * Tab names in the workbooks are ignored. Pass fill matches the fuel-pump family (#00B050).
 * A blank number is 0 in these arithmetic formulas, the same way Excel treats a blank.
 * "NA" on a dimensional nominal is Pass. A Y/N check passes only on Y.
 */

import { DEFAULT_INSPECTOR, type CellValue } from "./validationReport";

export type { CellValue };

export const PASS_FILL = "#00B050";
export const FAIL_FILL = "#FF0000";
const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";

type Num = number | typeof ERR_DIV | typeof ERR_VALUE;

export const FUEL_INJECTOR_CERTIFY = "I certify that this fuel injector validation is accurate and I authorize the disposition.";
export const FUEL_INJECTOR_FURTHER_CERTIFY = "I certify that the further review of this fuel injector is accurate and I authorize the later disposition.";
export const BRAKE_WEAR_CERTIFY = "I certify that this brake wear sensor validation is accurate and I authorize the disposition.";
export const BRAKE_WEAR_FURTHER_CERTIFY = "I certify that the further review of this brake wear sensor is accurate and I authorize the later disposition.";

export const INJECTOR_OVERALL =
  'IF(AND(H12:H17="Pass", H21:H24="Pass", H29:H31="Pass", H38="Pass", H47="Pass", H49="Pass", H53="Pass"),"Pass","Fail")';
export const BRAKE_OVERALL = 'IF(AND(H12:H18="Pass", H22:H24="Pass"),"Pass","Fail")';

const INJECTOR_RESULTS = ["H12", "H13", "H14", "H15", "H16", "H17", "H21", "H22", "H23", "H24", "H29", "H30", "H31", "H38", "H47", "H49", "H53"];
const BRAKE_RESULTS = ["H12", "H13", "H14", "H15", "H16", "H17", "H18", "H22", "H23", "H24"];

export function blankInjectorCells(): Record<string, CellValue> {
  return {
    H2: "Maxwell Tollefson",
    B8: DEFAULT_INSPECTOR,
    D16: 0,
    D17: 0,
    B40: 14,
    C47: 0.05,
    I41: 3,
    I42: 4,
    I43: 5,
    I44: 6,
    I45: 7,
    D53: "less than ",
    E53: 0,
    D34: false,
    H34: false,
    C57: false,
    E57: false,
    H57: false,
    C64: false,
    E64: false,
    H64: false,
  };
}

export function blankBrakeCells(): Record<string, CellValue> {
  return {
    H2: "Maxwell Tollefson",
    B8: DEFAULT_INSPECTOR,
    C28: false,
    E28: false,
    H28: false,
    C35: false,
    E35: false,
    H35: false,
  };
}

export function cellsFromData(data: unknown, blank: () => Record<string, CellValue>): Record<string, CellValue> {
  const base = blank();
  if (!data || typeof data !== "object") return base;
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object") return base;
  for (const [key, value] of Object.entries(cells as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") base[key] = value;
    else if (value === null) base[key] = "";
  }
  return base;
}

export function furtherSignatureOf(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const value = (data as { furtherSignature?: unknown }).furtherSignature;
  return typeof value === "string" ? value : "";
}

function read(cells: Record<string, CellValue>, addr: string): CellValue | null {
  const value = cells[addr];
  if (value === undefined || value === "") return null;
  return value;
}

function isNaNominal(value: CellValue | null): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "na";
}

function num(value: CellValue | null): Num {
  if (value === null || value === undefined || value === "") return 0;
  if (value === ERR_DIV || value === ERR_VALUE) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : ERR_VALUE;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = value.trim();
  if (text === "" || text.toLowerCase() === "na") return 0;
  if (text === ERR_DIV || text === ERR_VALUE) return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return ERR_VALUE;
}

function bin(left: Num, right: Num, op: (x: number, y: number) => number): Num {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  return op(left, right);
}

function div(left: Num, right: Num): Num {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  if (right === 0) return ERR_DIV;
  return left / right;
}

function between(sample: Num, min: Num, max: Num): string {
  if (typeof sample === "string") return sample;
  if (typeof min === "string") return min;
  if (typeof max === "string") return max;
  return sample >= min && sample <= max ? "Pass" : "Fail";
}

function yn(value: CellValue | null): string {
  return typeof value === "string" && value.trim().toLowerCase() === "y" ? "Pass" : "Fail";
}

function dimensional(cells: Record<string, CellValue>, row: number, computed: Record<string, CellValue>) {
  const nominal = read(cells, `B${row}`);
  if (isNaNominal(nominal)) {
    computed[`H${row}`] = "Pass";
    return;
  }
  const min = bin(num(nominal), num(read(cells, `D${row}`)), (left, right) => left - right);
  const max = bin(num(nominal), num(read(cells, `D${row}`)), (left, right) => left + right);
  computed[`E${row}`] = min;
  computed[`F${row}`] = max;
  computed[`H${row}`] = between(num(read(cells, `G${row}`)), min, max);
}

function allPass(addrs: string[], computed: Record<string, CellValue>, cells: Record<string, CellValue>): string {
  const display = { ...cells, ...computed };
  let error = "";
  for (const addr of addrs) {
    const value = display[addr];
    if (typeof value === "string" && value.startsWith("#")) error = error || value;
    else if (typeof value !== "string" || value.trim().toLowerCase() !== "pass") return error || "Fail";
  }
  return error || "Pass";
}

function regression(xs: number[], ys: number[]): { slope: number; intercept: number } | string {
  if (xs.length < 2 || xs.length !== ys.length) return ERR_VALUE;
  const n = xs.length;
  const meanX = xs.reduce((sum, value) => sum + value, 0) / n;
  const meanY = ys.reduce((sum, value) => sum + value, 0) / n;
  let nume = 0;
  let den = 0;
  for (let index = 0; index < n; index += 1) {
    const dx = (xs[index] ?? 0) - meanX;
    nume += dx * ((ys[index] ?? 0) - meanY);
    den += dx * dx;
  }
  if (den === 0) return ERR_DIV;
  const slope = nume / den;
  return { slope, intercept: meanY - slope * meanX };
}

export function evaluateInjector(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  for (let row = 12; row <= 17; row += 1) dimensional(cells, row, computed);
  for (let row = 21; row <= 24; row += 1) computed[`H${row}`] = yn(read(cells, `G${row}`));
  for (let row = 29; row <= 31; row += 1) {
    const nominal = num(read(cells, `B${row}`));
    const tolerance = bin(nominal, 0.1, (left, right) => left * right);
    const min = bin(nominal, tolerance, (left, right) => left - right);
    const max = bin(nominal, tolerance, (left, right) => left + right);
    computed[`D${row}`] = tolerance;
    computed[`E${row}`] = min;
    computed[`F${row}`] = max;
    computed[`H${row}`] = between(num(read(cells, `G${row}`)), min, max);
  }
  const coilMin = bin(num(read(cells, "B38")), num(read(cells, "D38")), (left, right) => left - right);
  const coilMax = bin(num(read(cells, "B38")), num(read(cells, "D38")), (left, right) => left + right);
  computed.E38 = coilMin;
  computed.F38 = coilMax;
  computed.H38 = between(num(read(cells, "G38")), coilMin, coilMax);
  const divisors = [6000, 6000, 3000, 3000, 3000];
  const knownX: number[] = [];
  const knownY: number[] = [];
  let trendError = "";
  for (let index = 0; index < 5; index += 1) {
    const row = 41 + index;
    const converted = div(num(read(cells, `B${row}`)), divisors[index] ?? 1);
    computed[`E${row}`] = converted;
    const x = num(read(cells, `I${row}`));
    if (typeof converted === "string") trendError = trendError || converted;
    if (typeof x === "string") trendError = trendError || x;
    if (typeof converted === "number" && typeof x === "number") {
      knownX.push(x);
      knownY.push(converted);
    }
  }
  const fit = trendError ? trendError : regression(knownX, knownY);
  for (let index = 0; index < 5; index += 1) {
    const row = 41 + index;
    if (typeof fit === "string") computed[`G${row}`] = fit;
    else computed[`G${row}`] = fit.intercept + fit.slope * (typeof num(read(cells, `I${row}`)) === "number" ? (num(read(cells, `I${row}`)) as number) : 0);
  }
  const sampleStatic = num(read(cells, "F47"));
  const convertedStatic = bin(sampleStatic, 0.7739, (left, right) => left * right);
  const half = div(num(read(cells, "B47")), 2);
  const band = bin(num(read(cells, "B47")), num(read(cells, "C47")), (left, right) => left * right);
  const minStatic = bin(half, band, (left, right) => left - right);
  const maxStatic = bin(half, band, (left, right) => left + right);
  computed.D47 = minStatic;
  computed.E47 = maxStatic;
  computed.G47 = convertedStatic;
  computed.H47 = between(convertedStatic, minStatic, maxStatic);
  computed.B48 = bin(convertedStatic, 4, (left, right) => left * right);
  const deviation = div(bin(num(computed.E41 as Num), num(computed.G41 as Num), (left, right) => left - right), num(computed.E41 as Num));
  computed.B49 = typeof deviation === "string" ? deviation : Math.abs(deviation);
  if (cells.H34 === true) computed.H49 = "Pass";
  else if (typeof computed.B49 === "string") computed.H49 = computed.B49;
  else computed.H49 = computed.B49 <= 0.05 ? "Pass" : "Fail";
  if (typeof fit === "string") {
    computed.B50 = fit;
    computed.B51 = fit;
  } else {
    computed.B50 = fit.slope;
    computed.B51 = fit.slope * 1000 * 60;
  }
  const leakMax = num(read(cells, "B53"));
  computed.F53 = leakMax;
  computed.H53 = between(num(read(cells, "G53")), num(read(cells, "E53")), leakMax);
  const overall = allPass(INJECTOR_RESULTS, computed, cells);
  computed.J2 = overall;
  computed.B56 = overall;
  return computed;
}

export function evaluateBrake(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  for (let row = 12; row <= 18; row += 1) dimensional(cells, row, computed);
  for (let row = 22; row <= 24; row += 1) computed[`H${row}`] = yn(read(cells, `G${row}`));
  const overall = allPass(BRAKE_RESULTS, computed, cells);
  computed.J2 = overall;
  computed.B27 = overall;
  return computed;
}

export function overallInjector(cells: Record<string, CellValue>): string {
  const value = evaluateInjector(cells).B56;
  return typeof value === "string" ? value : "";
}

export function overallBrake(cells: Record<string, CellValue>): string {
  const value = evaluateBrake(cells).B27;
  return typeof value === "string" ? value : "";
}

export function showInspection(value: CellValue | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR_VALUE;
    const rounded = Math.round(value * 1e6) / 1e6;
    return String(rounded);
  }
  return value;
}

export function inspectionFill(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("fail")) return FAIL_FILL;
  if (lower.includes("pass")) return PASS_FILL;
  return null;
}
