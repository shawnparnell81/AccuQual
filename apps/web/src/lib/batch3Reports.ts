/**
 * Shock, Air Compressor, Electric Lift Support, Gas Lift Support, and Coil Spring.
 * Formula text follows each workbook. Gas Lift is not Fuel Pump.
 * Conflicting Doc ID cells are not shown. Pass is checked after Fail.
 */

import { DEFAULT_INSPECTOR, type CellValue } from "./validationReport";

export type { CellValue };

const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";
type Num = number | typeof ERR_DIV | typeof ERR_VALUE;
type Value = CellValue | null;

export const SHOCK_CERTIFY = "";
export const COMPRESSOR_CERTIFY = "I certify that this air compressor validation is accurate and I authorize the disposition.";
export const ELECTRIC_CERTIFY = "I certify that this electric lift support validation is accurate and I authorize the disposition.";
export const GAS_CERTIFY = "I certify that this gas lift support validation is accurate and I authorize the disposition.";
export const GAS_FURTHER_CERTIFY = "I certify that the further review of this gas lift support is accurate and I authorize the later disposition.";
export const COIL_CERTIFY = "I certify that this coil spring validation is accurate and I authorize the disposition.";

function read(cells: Record<string, CellValue>, addr: string): Value {
  const value = cells[addr];
  if (value === undefined || value === "") return null;
  return value;
}

function isBlank(value: Value): boolean {
  return value === null || value === undefined || value === "";
}

function num(value: Value): Num {
  if (value === null || value === undefined || value === "") return 0;
  if (value === ERR_DIV || value === ERR_VALUE) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : ERR_VALUE;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = String(value).trim();
  if (text === ERR_DIV || text === ERR_VALUE) return text;
  if (/^-?\d+(\.\d+)?$/.test(text)) return Number(text);
  return ERR_VALUE;
}

function bin(left: Num, right: Num, op: (x: number, y: number) => number): Num {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  const result = op(left, right);
  return Number.isFinite(result) ? result : ERR_VALUE;
}

function div(left: Num, right: Num): Num {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  if (right === 0) return ERR_DIV;
  return left / right;
}

function countNums(values: Value[]): number {
  return values.filter((value) => typeof num(value) === "number" && !isBlank(value) && typeof value !== "boolean").length;
}

function sameText(left: Value, right: Value): boolean {
  if (isBlank(left) || isBlank(right)) return false;
  if (typeof left === "number" && typeof right === "number") return left === right;
  return String(left).trim().toLowerCase() === String(right).trim().toLowerCase();
}

function yes(value: Value): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "yes";
}

function isY(value: Value): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "y";
}

function isNaText(value: Value): boolean {
  return typeof value === "string" && value.trim().toLowerCase() === "na";
}

export function mergeCells(data: unknown, blank: () => Record<string, CellValue>): Record<string, CellValue> {
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

export function blankShock(): Record<string, CellValue> {
  return {
    H2: "Maxwell Tollefson",
    F5: DEFAULT_INSPECTOR,
    B41: false,
    D41: false,
    F41: false,
    B42: false,
    D42: false,
    F42: false,
    B43: false,
    D43: false,
    F43: false,
  };
}

export function evaluateShock(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const spec = (row: number) => read(cells, `C${row}`);
  const tol = (row: number) => read(cells, `D${row}`);
  const band = (sample: Value, nominal: Value, tolerance: Value): string => {
    const low = bin(num(nominal), num(tolerance), (left, right) => left - right);
    const high = bin(num(nominal), num(tolerance), (left, right) => left + right);
    const value = num(sample);
    if (typeof value === "string") return value;
    if (typeof low === "string") return low;
    if (typeof high === "string") return high;
    return value >= low && value <= high ? "Passed" : "Failed";
  };
  const atLeast = (sample: Value, nominal: Value): string => {
    const left = num(sample);
    const right = num(nominal);
    if (typeof left === "string") return left;
    if (typeof right === "string") return right;
    return left >= right ? "Passed" : "Failed";
  };
  const ten = (sample: Value): string => {
    const value = num(sample);
    if (typeof value === "string") return value;
    return value === 10 ? "Passed" : "Failed";
  };
  computed.C16 = bin(num(spec(15)), num(spec(17)), (left, right) => left - right);
  computed.G11 = ten(read(cells, "E11"));
  computed.H11 = ten(read(cells, "F11"));
  for (const row of [15, 16, 17, 24, 29, 35, 36, 37, 38]) {
    const nominal = row === 16 ? computed.C16 : spec(row);
    computed[`G${row}`] = band(read(cells, `E${row}`), nominal, tol(row));
    computed[`H${row}`] = band(read(cells, `F${row}`), nominal, tol(row));
  }
  computed.G18 = atLeast(read(cells, "E18"), spec(18));
  computed.H18 = atLeast(read(cells, "F18"), spec(18));
  const display = { ...cells, ...computed };
  let failed = 0;
  for (const [addr, value] of Object.entries(display)) {
    if (!/^[GH]\d+$/.test(addr)) continue;
    if (typeof value === "string" && value.trim().toLowerCase() === "failed") failed += 1;
  }
  computed.A3 = failed > 0 ? "Failed" : "Passed";
  return computed;
}

export function overallShock(cells: Record<string, CellValue>): string {
  const value = evaluateShock(cells).A3;
  return typeof value === "string" ? value : "";
}

const COMPRESSOR_ROWS = [12, 13, 14, 15, 16, 17, 18, 19, 23, 24, 25, 26, 27, 32, 33, 34, 35, 36, 37, 38, 42, 43];

export function blankCompressor(): Record<string, CellValue> {
  return { F2: "Maxwell Tollefson", B8: DEFAULT_INSPECTOR, B30: "12.0 VDC", B51: false, D51: false, E51: false };
}

/** The workbook leaves Pass/Fail blank. These columns are spec, tolerance, and actual, so a blank triple fails and a numeric triple uses absolute tolerance. */
export function evaluateCompressor(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  for (const row of COMPRESSOR_ROWS) {
    const spec = read(cells, `B${row}`);
    const tolerance = read(cells, `C${row}`);
    const actual = read(cells, `D${row}`);
    if (isBlank(spec) || isBlank(tolerance) || isBlank(actual)) {
      computed[`E${row}`] = "Fail";
      continue;
    }
    const delta = bin(num(actual), num(spec), (left, right) => Math.abs(left - right));
    const limit = num(tolerance);
    if (typeof delta === "string") computed[`E${row}`] = delta;
    else if (typeof limit === "string") computed[`E${row}`] = limit;
    else computed[`E${row}`] = delta <= limit ? "Pass" : "Fail";
  }
  const failed = COMPRESSOR_ROWS.some((row) => {
    const value = computed[`E${row}`];
    return typeof value !== "string" || value.toLowerCase() !== "pass";
  });
  computed.overall = failed ? "FAIL" : "PASS";
  return computed;
}

export function overallCompressor(cells: Record<string, CellValue>): string {
  const value = evaluateCompressor(cells).overall;
  return typeof value === "string" ? value : "";
}

export function blankElectric(): Record<string, CellValue> {
  return { E2: "Maxwell Tollefson", B7: "Gaci", B8: DEFAULT_INSPECTOR, B50: false, C50: false, E50: false };
}

export function evaluateElectric(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const present = (row: number) => (!isBlank(read(cells, `C${row}`)) && !isBlank(read(cells, `D${row}`)) ? "Pass" : "Fail");
  const equalPair = (row: number) => (sameText(read(cells, `C${row}`), read(cells, `D${row}`)) && !isBlank(read(cells, `C${row}`)) ? "Pass" : "Fail");
  const close = (row: number, limit: number) => {
    const left = read(cells, `C${row}`);
    const right = read(cells, `D${row}`);
    if (countNums([left, right]) < 2) return "Fail";
    const delta = bin(num(right), num(left), (a, b) => Math.abs(a - b));
    if (typeof delta === "string") return delta;
    return delta <= limit ? "Pass" : "Fail";
  };
  const spread = (addrs: string[], limit: number) => {
    const values = addrs.map((addr) => read(cells, addr));
    if (countNums(values) < addrs.length) return "Fail";
    const numbers = values.map((value) => num(value));
    if (numbers.some((value) => typeof value === "string")) return ERR_VALUE;
    const list = numbers as number[];
    const max = Math.max(...list);
    const min = Math.min(...list);
    return max - min <= limit ? "Pass" : "Fail";
  };
  computed.E12 = present(12);
  computed.E13 = equalPair(13);
  computed.E14 = close(14, 0.2);
  computed.E15 = close(15, 0.2);
  computed.E16 = (() => {
    const values = ["B16", "C16", "D16"].map((addr) => read(cells, addr));
    if (countNums(values) < 3) return "Fail";
    const delta = bin(num(values[0] ?? null), num(values[2] ?? null), (left, right) => Math.abs(left - right));
    if (typeof delta === "string") return delta;
    return delta <= 0.25 ? "Pass" : "Fail";
  })();
  computed.E17 = spread(["B17", "C17", "D17"], 100);
  computed.E18 = spread(["B18", "C18", "D18"], 4);
  for (const col of ["B", "C", "D"]) {
    computed[`${col}19`] = bin(num(read(cells, `${col}18`)), num(read(cells, `${col}20`)), (left, right) => left - right);
  }
  const lengthSpread = (addrs: string[], limit: number) => {
    const numbers = addrs.map((addr) => num(computed[addr] ?? read(cells, addr)));
    if (numbers.some((value) => typeof value === "string")) return ERR_VALUE;
    const list = numbers as number[];
    if (addrs.some((addr) => isBlank(computed[addr] ?? null) && isBlank(read(cells, addr)) && !(addr in computed))) return "Fail";
    return Math.max(...list) - Math.min(...list) <= limit ? "Pass" : "Fail";
  };
  computed.E19 = lengthSpread(["B19", "C19", "D19"], 4);
  computed.E20 = spread(["B20", "C20", "D20"], 4);
  computed.E27 = yes(read(cells, "C27")) && yes(read(cells, "D27")) ? "Pass" : "Fail";
  const hall = (primary: "C31" | "C32") => {
    const values = ["C31", "C32", "D31", "D32"].map((addr) => read(cells, addr));
    if (countNums(values) < 4) return "Fail";
    const c31 = num(read(cells, "C31"));
    const c32 = num(read(cells, "C32"));
    const d31 = num(read(cells, "D31"));
    const d32 = num(read(cells, "D32"));
    if ([c31, c32, d31, d32].some((value) => typeof value === "string")) return ERR_VALUE;
    const a = c31 as number;
    const b = c32 as number;
    const c = d31 as number;
    const d = d32 as number;
    const target = primary === "C31" ? Math.abs(c - a) <= a * 0.03 : Math.abs(d - b) <= b * 0.03;
    const cross = Math.abs(a - b) <= a * 0.03 && Math.abs(c - d) <= c * 0.03;
    return target && cross ? "Pass" : "Fail";
  };
  computed.E31 = hall("C31");
  computed.E32 = hall("C32");
  computed.E37 = (() => {
    if (countNums([read(cells, "C37"), read(cells, "D37")]) < 2) return "Fail";
    const prototype = num(read(cells, "D37"));
    const baseline = num(read(cells, "C37"));
    if (typeof prototype === "string") return prototype;
    if (typeof baseline === "string") return baseline;
    return prototype >= baseline ? "Passed" : "Fail";
  })();
  for (const col of ["B", "C", "D"]) {
    const stroke = col === "B" ? read(cells, "C20") : read(cells, `${col}20`);
    computed[`${col}41`] = div(bin(num(read(cells, `${col}39`)), num(read(cells, `${col}38`)), (left, right) => left - right), bin(num(stroke), 20, (left, right) => left - right));
  }
  computed.E41 = (() => {
    const values = ["B38", "C38", "D38"].map((addr) => read(cells, addr));
    if (countNums(values) < 3) return "Fail";
    const numbers = values.map((value) => num(value));
    if (numbers.some((value) => typeof value === "string")) return ERR_VALUE;
    const list = numbers as number[];
    const max = Math.max(...list);
    const min = Math.min(...list);
    return max - min <= max * 0.1 ? "Pass" : "Fail";
  })();
  for (const row of [46, 47, 48]) computed[`E${row}`] = yes(read(cells, `C${row}`)) && yes(read(cells, `D${row}`)) ? "Pass" : "Fail";
  return computed;
}

export function overallElectric(cells: Record<string, CellValue>): string {
  const result = evaluateElectric(cells);
  const values = Object.entries(result)
    .filter(([addr]) => addr.startsWith("E"))
    .map(([, value]) => value);
  if (values.some((value) => typeof value === "string" && value.toLowerCase().includes("fail"))) return "Fail";
  if (values.every((value) => typeof value === "string" && value.toLowerCase().includes("pass"))) return "Pass";
  return "Fail";
}

export function blankGas(): Record<string, CellValue> {
  return {
    H2: "Maxwell Tollefson",
    B8: DEFAULT_INSPECTOR,
    C41: false,
    E41: false,
    H41: false,
    C48: false,
    E48: false,
    H48: false,
  };
}

export function evaluateGas(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  for (let row = 13; row <= 21; row += 1) {
    const nominal = read(cells, `B${row}`);
    if (isNaText(nominal)) {
      computed[`H${row}`] = "Pass";
      continue;
    }
    const min = bin(num(nominal), num(read(cells, `D${row}`)), (left, right) => left - right);
    const max = bin(num(nominal), num(read(cells, `D${row}`)), (left, right) => left + right);
    computed[`E${row}`] = min;
    computed[`F${row}`] = max;
    const sample = num(read(cells, `G${row}`));
    if (typeof sample === "string" || typeof min === "string" || typeof max === "string") computed[`H${row}`] = ERR_VALUE;
    else computed[`H${row}`] = sample >= (min as number) && sample <= (max as number) ? "Pass" : "Fail";
  }
  const force = (row: number, mode: "open" | "avg") => {
    const flag = isY(read(cells, `C${row}`));
    if (row === 25 && isNaText(read(cells, `B${row}`))) {
      computed[`D${row}`] = flag ? "NA" : 0;
      computed[`H${row}`] = "Pass";
      return;
    }
    const nominal = num(read(cells, `B${row}`));
    computed[`D${row}`] = flag ? "NA" : 0;
    if (typeof nominal === "string") {
      computed[`E${row}`] = nominal;
      computed[`F${row}`] = nominal;
      computed[`H${row}`] = nominal;
      return;
    }
    if (mode === "open") {
      computed[`E${row}`] = nominal - nominal * 0.15;
      computed[`F${row}`] = flag ? 99999 : nominal;
    } else {
      computed[`E${row}`] = flag ? nominal : nominal;
      computed[`F${row}`] = flag ? 99999 : nominal * 1.15;
    }
    const sample = num(read(cells, `G${row}`));
    const min = computed[`E${row}`];
    const max = computed[`F${row}`];
    if (typeof sample === "string" || typeof min === "string" || typeof max === "string") computed[`H${row}`] = ERR_VALUE;
    else computed[`H${row}`] = sample >= (min as number) && sample <= (max as number) ? "Pass" : "Fail";
  };
  force(25, "open");
  force(26, "open");
  force(27, "avg");
  computed.H28 = isY(read(cells, "G28")) ? "Pass" : "Fail";
  computed.H29 = isY(read(cells, "G29")) ? "Pass" : "Fail";
  for (let row = 34; row <= 37; row += 1) {
    computed[`G${row}`] = sameText(read(cells, `D${row}`), read(cells, `B${row}`)) ? "Pass" : "Fail";
  }
  const needed = [
    ...[13, 14, 15, 16, 17, 18, 19, 20, 21, 25, 26, 27, 28, 29].map((row) => `H${row}`),
    "G34",
    "G35",
    "G36",
    "G37",
  ];
  const display = { ...cells, ...computed };
  const overall = needed.every((addr) => typeof display[addr] === "string" && display[addr].toLowerCase() === "pass") ? "Pass" : "Fail";
  computed.B40 = overall;
  computed.J2 = overall;
  return computed;
}

export function overallGas(cells: Record<string, CellValue>): string {
  const value = evaluateGas(cells).B40;
  return typeof value === "string" ? value : "";
}

export function blankCoil(): Record<string, CellValue> {
  return {
    G2: "Maxwell Tollefson",
    B8: DEFAULT_INSPECTOR,
    C12: -0.05,
    D12: 0.05,
    C13: -1.5,
    D13: 1.5,
    C14: "N/A",
    D14: "N/A",
    C15: "N/A",
    D15: "N/A",
    C16: -1.5,
    D16: 1.5,
    C17: -1.5,
    D17: 1.5,
    C18: -5,
    D18: 5,
    C19: -0.1,
    D19: 0.1,
    C24: -0.5,
    D24: 0.5,
    C26: -10,
    D26: 10,
    B35: false,
    D35: false,
    F35: false,
  };
}

function average(cells: Record<string, CellValue>, row: number): CellValue {
  const values = ["E", "F", "G"].map((col) => read(cells, `${col}${row}`)).filter((value) => !isBlank(value));
  if (values.length === 0) return "";
  const numbers = values.map((value) => num(value));
  if (numbers.some((value) => typeof value === "string")) return ERR_VALUE;
  const list = numbers as number[];
  return list.reduce((sum, value) => sum + value, 0) / list.length;
}

function bandResult(averageValue: CellValue, nominal: Value, low: Value, high: Value): string {
  if (averageValue === "") return "";
  const avg = num(averageValue);
  const min = bin(num(nominal), num(low), (left, right) => left + right);
  const max = bin(num(nominal), num(high), (left, right) => left + right);
  if (typeof avg === "string") return avg;
  if (typeof min === "string") return min;
  if (typeof max === "string") return max;
  return avg >= min && avg <= max ? "PASS" : "FAIL";
}

export function evaluateCoil(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  for (const row of [12, 13, 16, 17, 18, 19, 24, 26]) {
    computed[`H${row}`] = average(cells, row);
    computed[`I${row}`] = bandResult(computed[`H${row}`] ?? "", read(cells, `B${row}`), read(cells, `C${row}`), read(cells, `D${row}`));
  }
  computed.C23 = bin(num(read(cells, "B23")), 0.05, (left, right) => -(left * right));
  computed.D23 = bin(num(read(cells, "B23")), 0.05, (left, right) => left * right);
  computed.H23 = average(cells, 23);
  computed.I23 = bandResult(computed.H23, read(cells, "B23"), computed.C23, computed.D23);
  for (const row of [14, 15]) {
    computed[`H${row}`] = "N/A";
    const nominal = read(cells, `B${row}`);
    const first = read(cells, `E${row}`);
    if (isBlank(first)) computed[`I${row}`] = "";
    else {
      const matches = (sample: Value) => isBlank(sample) || sameText(nominal, sample);
      computed[`I${row}`] = sameText(nominal, first) && matches(read(cells, `F${row}`)) && matches(read(cells, `G${row}`)) ? "PASS" : "FALSE";
    }
  }
  computed.B30 = bin(bin(num(read(cells, "B25")), 9.81, (left, right) => left * right), 3.25 / 2, (left, right) => left * right);
  const wire = computed.H12;
  const outside = computed.H13;
  const force = computed.B30;
  if (wire === "" || outside === "" || force === "") computed.G31 = "";
  else {
    const wireD = num(wire ?? null);
    const od = num(outside ?? null);
    const fmax = num(force ?? null);
    const mean = bin(od, wireD, (left, right) => left - right);
    const index = div(mean, wireD);
    if (typeof index === "string") computed.G31 = index;
    else {
      const wahl = (4 * index - 1) / (4 * index - 4) + 0.615 / index;
      const numer = bin(bin(bin(8, mean, (left, right) => left * right), fmax, (left, right) => left * right), Number.isFinite(wahl) ? wahl : ERR_VALUE, (left, right) => left * right);
      const denom = bin(Math.PI, bin(wireD, 3, (left, right) => left ** right), (left, right) => left * right);
      computed.G31 = div(numer, denom);
    }
  }
  const stress = computed.G31;
  if (stress === "" || stress === undefined) {
    computed.C32 = "";
    computed.E32 = "";
    computed.G32 = "";
  } else if (typeof stress === "string") {
    computed.C32 = stress;
    computed.E32 = stress;
    computed.G32 = stress;
  } else {
    computed.C32 = stress <= 1200 ? "X" : "";
    computed.E32 = stress > 1200 ? "X" : "";
    computed.G32 = stress <= 1200 ? "PASS" : "FAIL";
  }
  return computed;
}

export function overallCoil(cells: Record<string, CellValue>): string {
  const result = evaluateCoil(cells);
  const values = Object.entries(result)
    .filter(([addr]) => addr.startsWith("I") || addr === "G32")
    .map(([, value]) => value)
    .filter((value) => value !== "" && value !== undefined);
  if (values.length === 0) return "";
  if (values.some((value) => typeof value === "string" && (value.toUpperCase() === "FAIL" || value.toUpperCase() === "FALSE" || value.startsWith("#")))) return "FAIL";
  if (values.every((value) => typeof value === "string" && value.toUpperCase() === "PASS")) return "PASS";
  return "";
}

export function showBatch(value: CellValue | null | undefined): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR_VALUE;
    return String(Math.round(value * 1e6) / 1e6);
  }
  return value;
}

export function batchFill(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("fail") || lower === "false") return "#FF0000";
  if (lower.includes("pass")) return "#00B050";
  return null;
}

export const BATCH3_KINDS = ["shock", "air_compressor", "electric_lift", "gas_lift", "coil_spring"] as const;
export type Batch3Kind = (typeof BATCH3_KINDS)[number];

export function isBatch3(kind: string): kind is Batch3Kind {
  return (BATCH3_KINDS as readonly string[]).includes(kind);
}

/** Sheet titles from the workbooks. Conflicting Doc ID cells are not part of these titles. */
export const BATCH3_SHEET_TITLE: Record<Batch3Kind, string> = {
  shock: "SHOCK VALIDATION REPORT",
  air_compressor: "AIR COMPRESSOR VALIDATION DOCUMENT",
  electric_lift: "ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT",
  gas_lift: "GAS LIFT SUPPORT VALIDATION DOCUMENT",
  coil_spring: "COIL SPRING VALIDATION DOCUMENT",
};

export function blankBatch(kind: Batch3Kind): Record<string, CellValue> {
  if (kind === "shock") return blankShock();
  if (kind === "air_compressor") return blankCompressor();
  if (kind === "electric_lift") return blankElectric();
  if (kind === "gas_lift") return blankGas();
  return blankCoil();
}

export function evaluateBatch(kind: Batch3Kind, cells: Record<string, CellValue>): Record<string, CellValue> {
  if (kind === "shock") return evaluateShock(cells);
  if (kind === "air_compressor") return evaluateCompressor(cells);
  if (kind === "electric_lift") return evaluateElectric(cells);
  if (kind === "gas_lift") return evaluateGas(cells);
  return evaluateCoil(cells);
}

export function overallBatch(kind: Batch3Kind, cells: Record<string, CellValue>): string {
  if (kind === "shock") return overallShock(cells);
  if (kind === "air_compressor") return overallCompressor(cells);
  if (kind === "electric_lift") return overallElectric(cells);
  if (kind === "gas_lift") return overallGas(cells);
  return overallCoil(cells);
}

export function cellsFromBatch(kind: Batch3Kind, data: unknown): Record<string, CellValue> {
  return mergeCells(data, () => blankBatch(kind));
}
