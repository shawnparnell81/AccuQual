/**
 * Fuel Pump Validation (Rev C).
 * Formula text matches the workbook, including both array formulas.
 * Blank cells in the containsBlanks range are #FFFF00.
 * Fail is #FF0000 and is checked before Pass (#00B050).
 */

import { DEFAULT_INSPECTOR, type CellValue } from "./validationReport";

export type { CellValue };

export const PASS_FILL = "#00B050";
export const FAIL_FILL = "#FF0000";
export const BLANK_FILL = "#FFFF00";
export const BLOCKED_FILL = "#000000";

export const YN_OPTIONS = ["Y", "N"] as const;

export const ARRAY_FORMULA = 'IF(AND(H13:H24="Pass",H30:H34="Pass",H38:H41="Pass",H46:H48="Pass"),"Pass","Fail")';

const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";

type Value = CellValue | null;

export const FORMULA_TEXT: Record<string, string> = {};

for (let row = 13; row <= 24; row += 1) {
  FORMULA_TEXT[`E${row}`] = `B${row}-D${row}`;
  FORMULA_TEXT[`F${row}`] = `B${row}+D${row}`;
  FORMULA_TEXT[`H${row}`] = `IF(OR(B${row}="NA"),"Pass",IF(AND(E${row}<=G${row},G${row}<=F${row}),"Pass","Fail"))`;
}

FORMULA_TEXT.D30 = 'IF(C30="Y", "NA", "0")';
FORMULA_TEXT.E30 = 'IF(C30 = "Y", (B30-B30*0.15), B30-B30*0.15)';
FORMULA_TEXT.F30 = 'IF(C30="Y", 99999, B30+D30)';
FORMULA_TEXT.H30 = 'IF(AND(G30>=E30, G30<=F30), "Pass", "Fail" )';
FORMULA_TEXT.D31 = 'IF(C31="Y", "NA", "0")';
FORMULA_TEXT.E31 = 'IF(C31 = "Y", B31, B31-D31)';
FORMULA_TEXT.F31 = 'IF(C31="Y",99999,(B31+D31)*1.15)';
FORMULA_TEXT.H31 = 'IF(AND(G31>=E31, G31<=F31), "Pass", "Fail" )';
FORMULA_TEXT.E32 = "B32-D32";
FORMULA_TEXT.F32 = "B32+D32";
FORMULA_TEXT.H32 = 'IF(AND(G32>=E32, G32<=F32), "Pass", "Fail" )';
FORMULA_TEXT.E33 = "B33-D33";
FORMULA_TEXT.F33 = "B33+D33";
FORMULA_TEXT.H33 = 'IF(AND(G33>=E33, G33<=F33), "Pass", "Fail" )';
FORMULA_TEXT.H34 = 'IF(AND(G34=B34), "Pass", "Fail")';
for (let row = 38; row <= 41; row += 1) {
  FORMULA_TEXT[`H${row}`] = `IF(AND(G${row}="Y"), "Pass", "Fail")`;
}
for (const row of [46, 47, 48]) {
  FORMULA_TEXT[`D${row}`] = `B${row}*0.1`;
  FORMULA_TEXT[`E${row}`] = `B${row}-D${row}`;
  FORMULA_TEXT[`F${row}`] = `B${row}+D${row}`;
  FORMULA_TEXT[`H${row}`] = `IF(AND(G${row}>=E${row}, G${row}<=F${row}), "Pass", "Fail" )`;
}
FORMULA_TEXT.J2 = ARRAY_FORMULA;
FORMULA_TEXT.B51 = ARRAY_FORMULA;

export const PARAMETER_NAMES = [
  "Bottom to lid height ",
  "Compressed height ",
  "Lid thickness diameter ",
  "Lid diameter ",
  "Mounting diameter ",
  "Float upper limit height from bottom of pump ",
  "Float arm lower limit height from bottom of pump ",
  "Supply line 1 diameter ",
  "Additional line 1 diameter ",
  "Additional line 2 diameter ",
];

export const FLOW_NOTE =
  "***Flow Rate has an allowable 15% tolerence below drawing specifications due to the differnce between D60 (factory) and Diesel (DMA) as testing mediums***                    ***Shutoff Pressure has an allowable 15% tolerence above drawing specifications due to the difference between D60 (factory) and Diesel (DMA) as testing mediums***";

export const PACK_NOTE =
  "***Tolerence is precalculated to be 10% and will update when the nominal value is input. Do not manually adjust the tolerance values in this section***";

export const REVIEW_NOTE =
  "***This section is only used if a sample fails intital inspection, but is passed later after follow up from the factory (test method improvements, drawing update/correction, etc)***";

export function blankCells(): Record<string, CellValue> {
  const cells: Record<string, CellValue> = {
    F2: "2026-06-02",
    H2: "Maxwell Tollefson",
    B6: "",
    G6: "",
    B7: "",
    G7: "",
    B8: DEFAULT_INSPECTOR,
    G8: "",
    B29: "[Input Pressure Value From Drawing Here]",
    B30: "",
    C30: "",
    G30: "",
    B31: "",
    C31: "",
    G31: "",
    B32: "",
    D32: "",
    G32: "",
    B33: "",
    D33: "",
    G33: "",
    B34: "",
    G34: "",
    G38: "",
    G39: "",
    G40: "",
    G41: "",
    B46: "",
    G46: "",
    B47: "",
    G47: "",
    B48: "",
    G48: "",
    C52: false,
    E52: false,
    H52: false,
    B53: "",
    B54: "",
    B58: "",
    C59: false,
    E59: false,
    H59: false,
    B60: "",
    B61: "",
  };
  for (let row = 13; row <= 24; row += 1) {
    cells[`A${row}`] = PARAMETER_NAMES[row - 13] ?? "";
    cells[`B${row}`] = "";
    cells[`D${row}`] = "";
    cells[`G${row}`] = "";
  }
  return cells;
}

export function cellsFromData(data: unknown): Record<string, CellValue> {
  const base = blankCells();
  if (!data || typeof data !== "object") return base;
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object") return base;
  for (const [key, value] of Object.entries(cells as Record<string, unknown>)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") base[key] = value;
    else if (value === null) base[key] = "";
  }
  return base;
}

export function parseInput(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

function isErr(v: unknown): v is typeof ERR_DIV | typeof ERR_VALUE {
  return v === ERR_DIV || v === ERR_VALUE;
}

function asNum(v: Value): number | string | null {
  if (v === null || v === "") return 0;
  if (isErr(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : ERR_VALUE;
  const t = v.trim();
  if (t === "") return 0;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

function num(v: Value): number | string {
  const n = asNum(v);
  if (n === null) return ERR_VALUE;
  return n;
}

function arith(a: Value, b: Value | number, op: (x: number, y: number) => number): number | string {
  const x = num(a);
  const y = typeof b === "number" ? b : num(b);
  if (typeof x === "string") return x;
  if (typeof y === "string") return y;
  return op(x, y);
}

function sub(a: Value, b: Value | number): number | string {
  return arith(a, b, (x, y) => x - y);
}

function add(a: Value, b: Value | number): number | string {
  return arith(a, b, (x, y) => x + y);
}

function mul(a: Value | number | string, b: number): number | string {
  if (typeof a === "number") return a * b;
  if (isErr(a)) return a;
  return arith(a, b, (x, y) => x * y);
}

function isBlank(value: Value): boolean {
  return value === null || value === undefined || value === "";
}

function textEq(value: Value, expected: string): boolean | string {
  if (isErr(value)) return value;
  if (value === null || value === "") return expected === "";
  if (typeof value === "number") {
    if (/^-?\d+(\.\d+)?$/.test(expected)) return value === Number(expected);
    return false;
  }
  if (typeof value === "boolean") return false;
  return value.toLowerCase() === expected.toLowerCase();
}

function excelEq(left: Value, right: Value): boolean | string {
  if (isErr(left)) return left;
  if (isErr(right)) return right;
  const leftBlank = left === null || left === "";
  const rightBlank = right === null || right === "";
  if (leftBlank && rightBlank) return true;
  if (leftBlank || rightBlank) {
    const other = leftBlank ? right : left;
    const n = asNum(other);
    if (typeof n === "string") return n;
    if (n === null) return false;
    return n === 0 && (other === 0 || other === "0");
  }
  if (typeof left === "number" || typeof right === "number") {
    const x = asNum(left);
    const y = asNum(right);
    if (typeof x === "string") return x;
    if (typeof y === "string") return y;
    if (x === null || y === null) return false;
    return x === y;
  }
  return String(left).toLowerCase() === String(right).toLowerCase();
}

function cmp(left: Value, op: ">=" | "<=", right: Value | number | string): boolean | string {
  if (isErr(left)) return left;
  if (typeof right !== "number" && isErr(right)) return right;
  const x = asNum(left);
  const y = asNum(typeof right === "number" || typeof right === "string" ? right : right);
  if (typeof x === "string") return x;
  if (typeof y === "string") return y;
  if (x === null || y === null) return ERR_VALUE;
  return op === ">=" ? x >= y : x <= y;
}

function both(left: boolean | string, right: boolean | string): boolean | string {
  if (typeof left === "string") return left;
  if (typeof right === "string") return right;
  return left && right;
}

function passFail(ok: boolean | string): string {
  if (typeof ok === "string") return ok;
  return ok ? "Pass" : "Fail";
}

function band(sample: Value, low: Value | number | string, high: Value | number | string): string {
  return passFail(both(cmp(sample, ">=", low), cmp(sample, "<=", high)));
}

function cellNumber(value: Value): number | string {
  if (isErr(value)) return value;
  if (value === null || value === "") return 0;
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  const n = asNum(value);
  if (typeof n === "string" || n === null) return value;
  return n;
}

export function evaluate(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const read = (addr: string): Value => {
    const value = cells[addr];
    if (value === undefined || value === "") return null;
    return value;
  };

  for (let row = 13; row <= 24; row += 1) {
    const nominal = read(`B${row}`);
    const tolerance = read(`D${row}`);
    const sample = read(`G${row}`);
    computed[`E${row}`] = sub(nominal, tolerance);
    computed[`F${row}`] = add(nominal, tolerance);
    if (isBlank(nominal) && isBlank(tolerance) && isBlank(sample)) {
      computed[`H${row}`] = "";
      continue;
    }
    const na = textEq(nominal, "NA");
    computed[`H${row}`] = na === true ? "Pass" : typeof na === "string" ? na : band(sample, computed[`E${row}`]!, computed[`F${row}`]!);
  }

  const minimumFlow = textEq(read("C30"), "Y");
  if (typeof minimumFlow === "string") {
    computed.D30 = minimumFlow;
    computed.E30 = minimumFlow;
    computed.F30 = minimumFlow;
    computed.H30 = minimumFlow;
  } else {
    computed.D30 = minimumFlow ? "NA" : "0";
    computed.E30 = sub(read("B30"), mul(read("B30"), 0.15));
    computed.F30 = minimumFlow ? 99999 : add(read("B30"), computed.D30);
    computed.H30 = band(read("G30"), computed.E30, computed.F30);
  }

  const minimumShutoff = textEq(read("C31"), "Y");
  if (typeof minimumShutoff === "string") {
    computed.D31 = minimumShutoff;
    computed.E31 = minimumShutoff;
    computed.F31 = minimumShutoff;
    computed.H31 = minimumShutoff;
  } else {
    computed.D31 = minimumShutoff ? "NA" : "0";
    computed.E31 = minimumShutoff ? cellNumber(read("B31")) : sub(read("B31"), computed.D31);
    computed.F31 = minimumShutoff ? 99999 : mul(add(read("B31"), computed.D31), 1.15);
    computed.H31 = band(read("G31"), computed.E31, computed.F31);
  }

  for (const row of [32, 33]) {
    computed[`E${row}`] = sub(read(`B${row}`), read(`D${row}`));
    computed[`F${row}`] = add(read(`B${row}`), read(`D${row}`));
    computed[`H${row}`] = band(read(`G${row}`), computed[`E${row}`]!, computed[`F${row}`]!);
  }

  const hardwareRequirement = read("B34");
  const hardwareSample = read("G34");
  // D34:F34 are the fixed NA labels. With no nominal in B34, Y means the hardware is included, same as the visual checks.
  if (isBlank(hardwareRequirement) && textEq(hardwareSample, "Y") === true) {
    computed.H34 = "Pass";
  } else {
    const hardware = excelEq(hardwareSample, hardwareRequirement);
    computed.H34 = typeof hardware === "string" ? hardware : hardware ? "Pass" : "Fail";
  }

  for (let row = 38; row <= 41; row += 1) {
    const yes = textEq(read(`G${row}`), "Y");
    computed[`H${row}`] = typeof yes === "string" ? yes : yes ? "Pass" : "Fail";
  }

  for (const row of [46, 47, 48]) {
    const nominal = read(`B${row}`);
    computed[`D${row}`] = mul(nominal, 0.1);
    computed[`E${row}`] = sub(nominal, computed[`D${row}`]!);
    computed[`F${row}`] = add(nominal, computed[`D${row}`]!);
    computed[`H${row}`] = band(read(`G${row}`), computed[`E${row}`]!, computed[`F${row}`]!);
  }

  const watched = [
    ...rows("H", 13, 24),
    ...rows("H", 30, 34),
    ...rows("H", 38, 41),
    ...rows("H", 46, 48),
  ];
  let sawFail = false;
  let error: string | null = null;
  for (const addr of watched) {
    const value = computed[addr];
    if (value === null || value === undefined || value === "") continue;
    if (value === ERR_DIV || value === ERR_VALUE) error = value;
    else if (!(typeof value === "string" && value.toLowerCase() === "pass")) sawFail = true;
  }
  const overall = error ?? (sawFail ? "Fail" : "Pass");
  computed.J2 = overall;
  computed.B51 = overall;
  return computed;
}

function rows(col: string, start: number, end: number): string[] {
  const out: string[] = [];
  for (let row = start; row <= end; row += 1) out.push(`${col}${row}`);
  return out;
}

export function showValue(value: Value): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR_VALUE;
    const rounded = Math.round(value * 1e8) / 1e8;
    return String(rounded);
  }
  return value;
}

type Box = [string, string, number, number];

const BLANK_BOXES: Box[] = [
  ["B", "D", 6, 8],
  ["G", "H", 6, 8],
  ["B", "D", 13, 22],
  ["G", "G", 13, 22],
  ["B", "C", 30, 31],
  ["G", "G", 30, 34],
  ["D", "D", 32, 33],
  ["B", "B", 32, 34],
  ["G", "G", 38, 41],
  ["B", "C", 46, 48],
  ["G", "G", 46, 48],
  ["B", "H", 53, 54],
];

const PASS_BOXES: Box[] = [
  ["H", "H", 1, 49],
  ["B", "H", 51, 51],
  ["H", "H", 52, 55],
  ["H", "H", 57, 57],
  ["B", "H", 58, 58],
  ["H", "H", 59, 1048576],
];

function colNum(col: string): number {
  let n = 0;
  for (const ch of col) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function inBoxes(addr: string, boxes: Box[]): boolean {
  const match = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!match) return false;
  const col = colNum(match[1]!);
  const row = Number(match[2]);
  return boxes.some(([start, end, r1, r2]) => col >= colNum(start) && col <= colNum(end) && row >= r1 && row <= r2);
}

export function inBlankRange(addr: string): boolean {
  return inBoxes(addr, BLANK_BOXES);
}

export function inPassFailRange(addr: string): boolean {
  return addr === "J2" || inBoxes(addr, PASS_BOXES);
}

/**
 * Blank rule is priority 1. Fail is priority 6 (and 8 on J2). Pass is priority 7 (and 9 on J2).
 * SEARCH is case-insensitive, so a cell containing both words is red.
 */
export function conditionalFill(addr: string, text: string): string | null {
  if (inBlankRange(addr) && text.trim().length === 0) return BLANK_FILL;
  if (!inPassFailRange(addr)) return null;
  const lower = text.toLowerCase();
  if (lower.includes("fail")) return FAIL_FILL;
  if (lower.includes("pass")) return PASS_FILL;
  return null;
}

export function overallResult(cells: Record<string, CellValue>): string {
  const value = evaluate(cells).J2;
  return typeof value === "string" ? value : "";
}

export function passingExample(): Record<string, CellValue> {
  const cells = blankCells();
  cells.B6 = "FP-200";
  cells.G6 = "DWG-200";
  cells.B7 = "Sensen";
  cells.G7 = "BATCH-7";
  cells.B8 = "Maxwell Tollefson";
  cells.G8 = "2026-06-02";
  for (let row = 13; row <= 22; row += 1) {
    cells[`B${row}`] = 100;
    cells[`D${row}`] = 1;
    cells[`G${row}`] = 100;
  }
  cells.B23 = "NA";
  cells.B24 = "NA";
  cells.B29 = "250";
  cells.B30 = 100;
  cells.C30 = "N";
  cells.G30 = 90;
  cells.B31 = 200;
  cells.C31 = "N";
  cells.G31 = 220;
  cells.B32 = 50;
  cells.D32 = 5;
  cells.G32 = 52;
  cells.B33 = 10;
  cells.D33 = 1;
  cells.G33 = 10;
  cells.B34 = "Y";
  cells.G34 = "Y";
  cells.G38 = "Y";
  cells.G39 = "Y";
  cells.G40 = "Y";
  cells.G41 = "Y";
  for (const row of [46, 47, 48]) {
    cells[`B${row}`] = 100;
    cells[`G${row}`] = 100;
  }
  cells.C52 = true;
  cells.B53 = "Maxwell Tollefson";
  cells.B54 = "Meets the drawing.";
  return cells;
}

/** A passing sheet with one dimension and one visual check outside the limit. */
export function mixedExample(): Record<string, CellValue> {
  const cells = passingExample();
  cells.G13 = 50;
  cells.G38 = "N";
  cells.B7 = "";
  cells.E52 = true;
  cells.C52 = false;
  return cells;
}
