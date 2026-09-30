/**
 * Air Spring Validation. The workbook tab and title cell still say Air Strut;
 * the purpose line is Air Spring. Formula text matches that sheet.
 * Blank nominal, tolerance, or sample is Fail. Pass fill is #0EBB5F.
 */

import { DEFAULT_INSPECTOR, type CellValue } from "./validationReport";

export type { CellValue };

export const PASS_FILL = "#0EBB5F";
export const FAIL_FILL = "#FF0000";
const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";

type Value = CellValue | null;
type Num = number | typeof ERR_DIV | typeof ERR_VALUE;

export const OVERALL_FORMULA = 'IF(COUNTIF(H13:H46, "Fail") + COUNTIF(F44:F46, "Fail") > 0, "FAIL", "PASS")';

export const DIMENSIONS: Array<{ row: number; label: string; text?: boolean }> = [
  { row: 13, label: "Overall Length of Air Spring (mm):" },
  { row: 14, label: "Stroke Length (mm):" },
  { row: 15, label: "Bump Stop Length (mm):" },
  { row: 16, label: "Top Mounting Type:", text: true },
  { row: 17, label: "Bottom Mounting Type:", text: true },
  { row: 18, label: "Top Air Bag Construction:", text: true },
  { row: 19, label: "Bottom Air Bag Construction:", text: true },
  { row: 20, label: "Paint Thickness (microns):" },
];

export const PNEUMATIC: Array<{ row: number; label: string }> = [
  { row: 24, label: "Force (N) at 20 PSI:" },
  { row: 25, label: "Force (N) at 40 PSI:" },
  { row: 26, label: "Spring Rate (N/mm) at 20 PSI:" },
  { row: 27, label: "Spring Rate (N/mm) at 40 PSI:" },
];

export const ELECTRONICS: Array<{ row: number; label: string }> = [
  { row: 34, label: "Resistance of Electronics (Ohms):" },
  { row: 35, label: "Inductance of Electronics @ 1kHz (mH):" },
  { row: 36, label: "Impedance of Electronics @ 1kHz (Ohms):" },
  { row: 37, label: "Hardware Kit Contents:" },
  { row: 38, label: "Location 1 Thread Size and Nut Style:" },
  { row: 39, label: "Location 2 Thread Size and Nut Style:" },
  { row: 40, label: "Location 3 Thread Size and Nut Style:" },
];

export const WEIGHTS: Array<{ row: number; label: string }> = [
  { row: 44, label: "Airbag Weight (lbs):" },
  { row: 45, label: "Hardware Weight (oz):" },
  { row: 46, label: "Total Package Weight (lbs):" },
];

export const AIR_SPRING_CERTIFY = "I certify that this air spring validation is accurate and I authorize the disposition.";

export const FORMULA_TEXT: Record<string, string> = {
  B28: "(B9*(D9/100)/2/F9)*4.45",
  B29: "(B28-B24)/((B25-B24)/20)+20",
  F29: "(B28-F24)/((F25-F24)/20)+20",
  B30: "((B29-20)*((B27-B26)/20))+B26",
  F30: "((F29-20)*((F27-F26)/20))+F26",
  G7: OVERALL_FORMULA,
  B48: OVERALL_FORMULA,
};

for (const item of [...DIMENSIONS, ...PNEUMATIC]) {
  FORMULA_TEXT[`H${item.row}`] = `IF(OR(B${item.row}="", D${item.row}="", F${item.row}=""), "Fail", IF(ABS(F${item.row} - B${item.row}) <= D${item.row}, "Pass", "Fail"))`;
}
FORMULA_TEXT.H29 = 'IF(OR(B29="", D29="", F29=""), "Fail", IF(ABS(F29 - B29) <= D29, "Pass", "Fail"))';
FORMULA_TEXT.H30 = 'IF(OR(B30="", D30="", F30=""), "Fail", IF(ABS(F30 - B30) <= D30, "Pass", "Fail"))';
for (const item of ELECTRONICS) FORMULA_TEXT[`H${item.row}`] = `IF(OR(B${item.row}="", E${item.row}=""), "Fail", "Pass")`;
for (const item of WEIGHTS) FORMULA_TEXT[`F${item.row}`] = `IF(OR(B${item.row}="", D${item.row}=""), "Fail", "Pass")`;

export function blankCells(): Record<string, CellValue> {
  return { G2: "Maxwell Tollefson", B8: DEFAULT_INSPECTOR, F48: false, B50: "" };
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

function isBlank(value: Value): boolean {
  return value === null || value === undefined || value === "";
}

function read(cells: Record<string, CellValue>, addr: string): Value {
  const value = cells[addr];
  if (value === undefined || value === "") return null;
  return value;
}

function num(value: Value): Num {
  if (value === null || value === undefined || value === "") return 0;
  if (value === ERR_DIV || value === ERR_VALUE) return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : ERR_VALUE;
  if (typeof value === "boolean") return value ? 1 : 0;
  const text = value.trim();
  if (text === "") return 0;
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

function tolerancePass(nominal: Value, tolerance: Value, sample: Value): string {
  if (isBlank(nominal) || isBlank(tolerance) || isBlank(sample)) return "Fail";
  const delta = bin(num(sample), num(nominal), (sampleNo, nominalNo) => Math.abs(sampleNo - nominalNo));
  const limit = num(tolerance);
  if (typeof delta === "string") return delta;
  if (typeof limit === "string") return limit;
  return delta <= limit ? "Pass" : "Fail";
}

function presencePass(left: Value, right: Value): string {
  if (isBlank(left) || isBlank(right)) return "Fail";
  return "Pass";
}

function ridePsi(force: Num, at20: Num, at40: Num): Num {
  const span = div(bin(at40, at20, (left, right) => left - right), 20);
  return bin(div(bin(force, at20, (left, right) => left - right), span), 20, (left, right) => left + right);
}

function rideRate(psi: Num, at20: Num, at40: Num): Num {
  const span = div(bin(at40, at20, (left, right) => left - right), 20);
  return bin(bin(bin(psi, 20, (left, right) => left - right), span, (left, right) => left * right), at20, (left, right) => left + right);
}

function countFail(addrs: string[], display: Record<string, CellValue | undefined>): number {
  let count = 0;
  for (const addr of addrs) {
    const value = display[addr];
    if (typeof value === "string" && value.trim().toLowerCase() === "fail") count += 1;
  }
  return count;
}

export function evaluate(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  for (const item of [...DIMENSIONS, ...PNEUMATIC]) {
    computed[`H${item.row}`] = tolerancePass(read(cells, `B${item.row}`), read(cells, `D${item.row}`), read(cells, `F${item.row}`));
  }
  const rideForce = bin(
    div(div(bin(num(read(cells, "B9")), div(num(read(cells, "D9")), 100), (left, right) => left * right), 2), num(read(cells, "F9"))),
    4.45,
    (left, right) => left * right,
  );
  computed.B28 = rideForce;
  const nominalPsi = ridePsi(rideForce, num(read(cells, "B24")), num(read(cells, "B25")));
  const samplePsi = ridePsi(rideForce, num(read(cells, "F24")), num(read(cells, "F25")));
  computed.B29 = nominalPsi;
  computed.F29 = samplePsi;
  computed.H29 = tolerancePass(nominalPsi, read(cells, "D29"), samplePsi);
  const nominalRate = rideRate(nominalPsi, num(read(cells, "B26")), num(read(cells, "B27")));
  const sampleRate = rideRate(samplePsi, num(read(cells, "F26")), num(read(cells, "F27")));
  computed.B30 = nominalRate;
  computed.F30 = sampleRate;
  computed.H30 = tolerancePass(nominalRate, read(cells, "D30"), sampleRate);
  for (const item of ELECTRONICS) computed[`H${item.row}`] = presencePass(read(cells, `B${item.row}`), read(cells, `E${item.row}`));
  for (const item of WEIGHTS) computed[`F${item.row}`] = presencePass(read(cells, `B${item.row}`), read(cells, `D${item.row}`));
  const display: Record<string, CellValue | undefined> = { ...cells, ...computed };
  const hRange: string[] = [];
  for (let row = 13; row <= 46; row += 1) hRange.push(`H${row}`);
  const fails = countFail(hRange, display) + countFail(["F44", "F45", "F46"], display);
  const overall = fails > 0 ? "FAIL" : "PASS";
  computed.G7 = overall;
  computed.B48 = overall;
  return computed;
}

export function showValue(value: Value): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR_VALUE;
    return String(Math.round(value * 1e8) / 1e8);
  }
  return value;
}

export function statusFill(text: string): string | null {
  const lower = text.toLowerCase();
  if (lower.includes("fail")) return FAIL_FILL;
  if (lower.includes("pass")) return PASS_FILL;
  return null;
}

export function overallResult(cells: Record<string, CellValue>): string {
  const value = evaluate(cells).G7;
  return typeof value === "string" ? value : "";
}

export function passingExample(): Record<string, CellValue> {
  const cells = blankCells();
  cells.B9 = 4000;
  cells.D9 = 50;
  cells.F9 = 1;
  for (const item of DIMENSIONS) {
    cells[`B${item.row}`] = item.text ? "Type A" : 10;
    cells[`D${item.row}`] = item.text ? 0 : 1;
    cells[`F${item.row}`] = item.text ? "Type A" : 10;
  }
  for (const item of PNEUMATIC) cells[`D${item.row}`] = 1;
  cells.B24 = 100;
  cells.F24 = 100;
  cells.B25 = 200;
  cells.F25 = 200;
  cells.B26 = 10;
  cells.F26 = 10;
  cells.B27 = 20;
  cells.F27 = 20;
  cells.D29 = 1;
  cells.D30 = 1;
  for (const item of ELECTRONICS) {
    cells[`B${item.row}`] = "Kit";
    cells[`E${item.row}`] = "Kit";
  }
  for (const item of WEIGHTS) {
    cells[`B${item.row}`] = 1;
    cells[`D${item.row}`] = 1;
  }
  return cells;
}
