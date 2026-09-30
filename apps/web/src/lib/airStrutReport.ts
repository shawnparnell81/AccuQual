/**
 * Air Strut Validation Document.
 * Formula text matches the workbook. Blank nominal, tolerance, or sample is Fail.
 * Pass fill is #0EBB5F. Fail fill is #FF0000. Fail is checked before Pass.
 */

import { DEFAULT_INSPECTOR, type CellValue } from "./validationReport";

export type { CellValue };

export const PASS_FILL = "#0EBB5F";
export const FAIL_FILL = "#FF0000";
const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";

type Value = CellValue | null;
type Num = number | typeof ERR_DIV | typeof ERR_VALUE;

export const OVERALL_FORMULA =
  'IF(COUNTIF(H13:H82, "Fail") + COUNTIF(D40:H65, "Fail") + COUNTIF(F79:F82, "Fail") > 0, "FAIL", "PASS")';

export const VELOCITY_COLS = ["D", "E", "F", "G", "H"] as const;
export const VELOCITIES = ["0.05", "0.1", "0.3", "0.6", "1"] as const;

export const DIMENSIONS: Array<{ row: number; label: string; text?: boolean }> = [
  { row: 13, label: "Overall Length of Air Strut (mm):" },
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

export interface DampingState {
  label: string;
  amp: string;
  nominalComp: number;
  nominalReb: number;
  sampleComp: number;
  sampleReb: number;
  tolComp: number;
  tolReb: number;
  passComp: number;
  passReb: number;
}

function dampingState(label: string, nominalComp: number): DampingState {
  return {
    label,
    amp: `B${nominalComp}`,
    nominalComp,
    nominalReb: nominalComp + 1,
    sampleComp: nominalComp + 2,
    sampleReb: nominalComp + 3,
    tolComp: nominalComp + 4,
    tolReb: nominalComp + 5,
    passComp: nominalComp + 6,
    passReb: nominalComp + 7,
  };
}

export const DAMPING_STATES: DampingState[] = [
  dampingState("State 1", 34),
  dampingState("State 2", 42),
  dampingState("State 3", 50),
  dampingState("State 4", 58),
];

export const ELECTRONICS: Array<{ row: number; label: string }> = [
  { row: 69, label: "Resistance of Electronics (Ohms):" },
  { row: 70, label: "Inductance of Electronics @ 1kHz (mH):" },
  { row: 71, label: "Impedance of Electronics @ 1kHz (Ohms):" },
  { row: 72, label: "Hardware Kit Contents:" },
  { row: 73, label: "Location 1 Thread Size and Nut Style:" },
  { row: 74, label: "Location 2 Thread Size and Nut Style:" },
  { row: 75, label: "Location 3 Thread Size and Nut Style:" },
];

export const WEIGHTS: Array<{ row: number; label: string }> = [
  { row: 79, label: "Airbag Weight (lbs):" },
  { row: 80, label: "Strut Body Weight (lbs):" },
  { row: 81, label: "Hardware Weight (oz):" },
  { row: 82, label: "Total Package Weight (lbs):" },
];

export const AIR_STRUT_CERTIFY = "I certify that this air strut validation is accurate and I authorize the disposition.";

export const FORMULA_TEXT: Record<string, string> = {
  B28: "(B9*(D9/100)/2/F9)*4.45",
  B29: "(B28-B24)/((B25-B24)/20)+20",
  F29: "(B28-F24)/((F25-F24)/20)+20",
  B30: "((B29-20)*((B27-B26)/20))+B26",
  F30: "((F29-20)*((F27-F26)/20))+F26",
  G7: OVERALL_FORMULA,
  B84: OVERALL_FORMULA,
};

for (const item of [...DIMENSIONS, ...PNEUMATIC]) {
  const row = item.row;
  FORMULA_TEXT[`H${row}`] = `IF(OR(B${row}="", D${row}="", F${row}=""), "Fail", IF(ABS(F${row} - B${row}) <= D${row}, "Pass", "Fail"))`;
}
FORMULA_TEXT.H29 = 'IF(OR(B29="", D29="", F29=""), "Fail", IF(ABS(F29 - B29) <= D29, "Pass", "Fail"))';
FORMULA_TEXT.H30 = 'IF(OR(B30="", D30="", F30=""), "Fail", IF(ABS(F30 - B30) <= D30, "Pass", "Fail"))';

for (const state of DAMPING_STATES) {
  for (const col of VELOCITY_COLS) {
    FORMULA_TEXT[`${col}${state.passComp}`] =
      `IF(COUNT(${col}${state.nominalComp}, ${col}${state.sampleComp}, ${col}${state.tolComp}) < 3, "Fail", IF(ABS(${col}${state.sampleComp} - ${col}${state.nominalComp}) <= ${col}${state.tolComp}, "Pass", "Fail"))`;
    FORMULA_TEXT[`${col}${state.passReb}`] =
      `IF(COUNT(${col}${state.nominalReb}, ${col}${state.sampleReb}, ${col}${state.tolReb}) < 3, "Fail", IF(ABS(${col}${state.sampleReb} - ${col}${state.nominalReb}) <= ${col}${state.tolReb}, "Pass", "Fail"))`;
  }
}
for (const item of ELECTRONICS) {
  FORMULA_TEXT[`H${item.row}`] = `IF(OR(B${item.row}="", E${item.row}=""), "Fail", "Pass")`;
}
for (const item of WEIGHTS) {
  FORMULA_TEXT[`F${item.row}`] = `IF(OR(B${item.row}="", D${item.row}=""), "Fail", "Pass")`;
}

export function blankCells(): Record<string, CellValue> {
  return {
    G2: "Maxwell Tollefson",
    B6: "",
    E6: "",
    B7: "",
    E7: "",
    B8: DEFAULT_INSPECTOR,
    E8: "",
    B9: "",
    D9: "",
    F9: "",
    F84: false,
    B86: "",
  };
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

function countNumbers(...values: Value[]): number {
  let count = 0;
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value)) count += 1;
    else if (typeof value === "string" && /^-?\d+(\.\d+)?$/.test(value.trim())) count += 1;
  }
  return count;
}

function dampingPass(nominal: Value, sample: Value, tolerance: Value): string {
  if (countNumbers(nominal, sample, tolerance) < 3) return "Fail";
  return tolerancePass(nominal, tolerance, sample);
}

function presencePass(left: Value, right: Value): string {
  if (isBlank(left) || isBlank(right)) return "Fail";
  return "Pass";
}

function asNum(value: CellValue | undefined): Num {
  if (typeof value === "number") return Number.isFinite(value) ? value : ERR_VALUE;
  if (value === ERR_DIV || value === ERR_VALUE) return value;
  return num(value ?? null);
}

function range(cols: readonly string[], start: number, end: number): string[] {
  const out: string[] = [];
  for (let row = start; row <= end; row += 1) {
    for (const col of cols) out.push(`${col}${row}`);
  }
  return out;
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

  const weight = num(read(cells, "B9"));
  const distribution = num(read(cells, "D9"));
  const ratio = num(read(cells, "F9"));
  const rideForce = bin(div(div(bin(weight, div(distribution, 100), (left, right) => left * right), 2), ratio), 4.45, (left, right) => left * right);
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

  for (const state of DAMPING_STATES) {
    for (const col of VELOCITY_COLS) {
      computed[`${col}${state.passComp}`] = dampingPass(
        read(cells, `${col}${state.nominalComp}`),
        read(cells, `${col}${state.sampleComp}`),
        read(cells, `${col}${state.tolComp}`),
      );
      computed[`${col}${state.passReb}`] = dampingPass(
        read(cells, `${col}${state.nominalReb}`),
        read(cells, `${col}${state.sampleReb}`),
        read(cells, `${col}${state.tolReb}`),
      );
    }
  }

  for (const item of ELECTRONICS) {
    computed[`H${item.row}`] = presencePass(read(cells, `B${item.row}`), read(cells, `E${item.row}`));
  }
  for (const item of WEIGHTS) {
    computed[`F${item.row}`] = presencePass(read(cells, `B${item.row}`), read(cells, `D${item.row}`));
  }

  const display: Record<string, CellValue | undefined> = { ...cells, ...computed };
  const fails =
    countFail(range(["H"], 13, 82), display) +
    countFail(range(["D", "E", "F", "G", "H"], 40, 65), display) +
    countFail(range(["F"], 79, 82), display);
  const overall = fails > 0 ? "FAIL" : "PASS";
  computed.G7 = overall;
  computed.B84 = overall;
  return computed;
}

function ridePsi(force: Num, at20: Num, at40: Num): Num {
  const span = div(bin(at40, at20, (left, right) => left - right), 20);
  return bin(div(bin(force, at20, (left, right) => left - right), span), 20, (left, right) => left + right);
}

function rideRate(psi: Num, at20: Num, at40: Num): Num {
  const span = div(bin(at40, at20, (left, right) => left - right), 20);
  return bin(bin(bin(psi, 20, (left, right) => left - right), span, (left, right) => left * right), at20, (left, right) => left + right);
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

export function authorizedSignatureOf(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const value = (data as { authorizedSignature?: unknown }).authorizedSignature;
  return typeof value === "string" ? value : "";
}

export function passingExample(): Record<string, CellValue> {
  const cells = blankCells();
  cells.B6 = "NP-BLANK";
  cells.E6 = "DWG-1";
  cells.B7 = "Factory";
  cells.E7 = "PO-1";
  cells.B9 = 4000;
  cells.D9 = 50;
  cells.F9 = 1;
  for (const item of DIMENSIONS) {
    cells[`B${item.row}`] = item.text ? "Type A" : 10;
    cells[`D${item.row}`] = item.text ? 0 : 1;
    cells[`F${item.row}`] = item.text ? "Type A" : 10;
  }
  for (const item of PNEUMATIC) {
    cells[`D${item.row}`] = 1;
  }
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
  for (const state of DAMPING_STATES) {
    cells[state.amp] = "1.0";
    for (const col of VELOCITY_COLS) {
      cells[`${col}${state.nominalComp}`] = 100;
      cells[`${col}${state.sampleComp}`] = 100;
      cells[`${col}${state.tolComp}`] = 5;
      cells[`${col}${state.nominalReb}`] = 80;
      cells[`${col}${state.sampleReb}`] = 80;
      cells[`${col}${state.tolReb}`] = 5;
    }
  }
  for (const item of ELECTRONICS) {
    cells[`B${item.row}`] = item.row >= 72 ? "Kit" : 1;
    cells[`E${item.row}`] = item.row >= 72 ? "Kit" : 1;
  }
  for (const item of WEIGHTS) {
    cells[`B${item.row}`] = 1;
    cells[`D${item.row}`] = 1;
  }
  return cells;
}
