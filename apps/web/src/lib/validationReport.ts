/**
 * CSA VALIDATION REPORT (Rev C), sheet "Test Report".
 * Later Excel workbooks should follow this same cell model: one address, a formula or fill, answers in data.cells.
 * Formula text and conditional-formatting ranges match the workbook.
 * Passed fill is theme accent6 (#4EA72E). Failed fill is #FF0000.
 * Row tints are the workbook theme colors at tint 0.8. Gray is lt2 at tint -0.25.
 */

export type CellValue = string | number | boolean;

export type ValidationFormType =
  | "csa"
  | "fuel_pump"
  | "air_strut"
  | "air_spring"
  | "fuel_injector"
  | "brake_wear"
  | "shock"
  | "air_compressor"
  | "electric_lift"
  | "gas_lift"
  | "coil_spring";

const NAMED_KINDS = new Set<ValidationFormType>([
  "fuel_pump",
  "air_strut",
  "air_spring",
  "fuel_injector",
  "brake_wear",
  "shock",
  "air_compressor",
  "electric_lift",
  "gas_lift",
  "coil_spring",
]);

/** Records saved before the fuel pump form have no formType and stay CSA. */
export function formTypeOf(data: unknown): ValidationFormType {
  const raw = data && typeof data === "object" ? (data as { formType?: unknown }).formType : undefined;
  if (typeof raw === "string" && NAMED_KINDS.has(raw as ValidationFormType)) return raw as ValidationFormType;
  return "csa";
}

export const VALIDATION_FORMS: Record<ValidationFormType, { formKey: string; title: string; pass: string; revision: string }> = {
  csa: { formKey: "frm-val-001", title: "CSA VALIDATION REPORT", pass: "#4EA72E", revision: "C" },
  fuel_pump: { formKey: "frm-val-007", title: "FUEL PUMP VALIDATION DOCUMENT", pass: "#00B050", revision: "C" },
  air_strut: { formKey: "frm-val-010", title: "FRM-VAL-010 AIR STRUT VALIDATION DOCUMENT", pass: "#0EBB5F", revision: "A" },
  air_spring: { formKey: "frm-val-011", title: "FRM-VAL-011 AIR SPRING VALIDATION DOCUMENT", pass: "#0EBB5F", revision: "A" },
  fuel_injector: { formKey: "frm-val-008", title: "FRM-VAL-008 FUEL INJECTOR VALIDATION DOCUMENT", pass: "#00B050", revision: "B" },
  brake_wear: { formKey: "frm-val-009", title: "FRM-VAL-009 BRAKE WEAR SENSOR VALIDATION DOCUMENT", pass: "#00B050", revision: "A" },
  shock: { formKey: "frm-val-002", title: "FRM-VAL-002 SHOCK VALIDATION REPORT", pass: "#4EA72E", revision: "B" },
  air_compressor: { formKey: "frm-val-003", title: "FRM-VAL-003 AIR COMPRESSOR VALIDATION DOCUMENT", pass: "#00B050", revision: "A" },
  electric_lift: { formKey: "frm-val-004", title: "FRM-VAL-004 ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT", pass: "#00B050", revision: "B" },
  gas_lift: { formKey: "frm-val-005", title: "FRM-VAL-005 GAS LIFT SUPPORT VALIDATION DOCUMENT", pass: "#00B050", revision: "B" },
  coil_spring: { formKey: "frm-val-006", title: "FRM-VAL-006 COIL SPRING VALIDATION DOCUMENT", pass: "#00B050", revision: "A" },
};

export const PASSED_FILL = "#4EA72E";
export const FAILED_FILL = "#FF0000";

export const FILLS = {
  passed: PASSED_FILL,
  failed: FAILED_FILL,
  gray: "#AEAEAE",
  gold: "#CAEEFB",
  orange: "#FBE3D6",
  lilac: "#F2CFEE",
  green: "#D9F2D0",
} as const;

/** Data-validation list sources, copied from the sheet. */
export const SUPPLIER_LIST_FORMULA = "Sensen, Jinbo,     ----";
export const INSPECTOR_LIST_FORMULA = "Timothy Therrien, Glen Fulmore, Ron Wertz, Sam Giannetti, Maxwell Tollefson, Lee Beeson";

export function listOptions(formula: string): string[] {
  return formula
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

export const SUPPLIER_OPTIONS = listOptions(SUPPLIER_LIST_FORMULA);
export const DEFAULT_INSPECTOR = "Shawn Parnell";
export const INSPECTOR_OPTIONS = [DEFAULT_INSPECTOR, ...listOptions(INSPECTOR_LIST_FORMULA)];

const ERR_DIV = "#DIV/0!";
const ERR_VALUE = "#VALUE!";
const PERCENT = new Set(["B17", "C17", "D17", "E17", "F17"]);

type Value = CellValue | null;
/** Formula text as stored in the workbook, including shared-formula shifts. ≤ rows compare with <=. */
export const FORMULA_TEXT: Record<string, string> = {
  A1: 'IF(COUNTIF(F:G, "Failed") > 0, "Failed", "Passed")',
  F12: 'IF(D12=B12, "Passed", "Failed")',
  G12: 'IF(E12=B12, "Passed", "Failed")',
  F13: 'IF(AND(D13>=B13-C13, D13<=B13+C13), "Passed", "Failed")',
  G13: 'IF(AND(E13>=B13-C13, E13<=B13+C13), "Passed", "Failed")',
  B14: "B13-B15",
  D14: "D13-D15",
  F14: 'IF(AND(D14>=B14-C14, D14<=B14+C14), "Passed", "Failed")',
  F15: 'IF(AND(D15>=B15-C15, D15<=B15+C15), "Passed", "Failed")',
  F16: 'IF(AND(D16>=B16-C16, D16<=B16+C16), "Passed", "Failed")',
  B17: "B16/B15",
  D17: "D16/D15",
  E17: "E16/E15",
  F18: 'IF(D18<=B18, "Passed", "Failed")',
  G18: 'IF(E18<=B18, "Passed", "Failed")',
  F22: 'IF(AND(D22>=B22-C22, D22<=B22+C22), "Passed", "Failed")',
  F25: 'IF(AND(D25>=B25-C25, D25<=B25+C25), "Passed", "Failed")',
  F30: 'IF(AND(D30>=B30-C30, D30<=B30+C30), "Passed", "Failed")',
  F36: 'IF(AND(D36>=B36-C36, D36<=B36+C36), "Passed", "Failed")',
  F37: 'IF(AND(D37>=B37-C37, D37<=B37+C37), "Passed", "Failed")',
  F39: 'IF(AND(D39>=B39-C39, D39<=B39+C39), "Passed", "Failed")',
  F40: 'IF(AND(D40>=B40-C40, D40<=B40+C40), "Passed", "Failed")',
  F41: 'IF(D41<=B41, "Passed", "Failed")',
  G41: 'IF(E41<=B41, "Passed", "Failed")',
  F45: 'IF(D45<=B45, "Passed", "Failed")',
  G45: 'IF(E45<=B45, "Passed", "Failed")',
  F46: 'IF(AND(D46>=B46-C46, D46<=B46+C46), "Passed", "Failed")',
  G46: 'IF(AND(E46>=B46-C46, E46<=B46+C46), "Passed", "Failed")',
};

export function blankCells(): Record<string, CellValue> {
  return {
    G2: "Maxwell Tollefson",
    B6: "",
    F6: "",
    B7: "",
    F7: "",
    B8: DEFAULT_INSPECTOR,
    F8: "",
    B12: 10,
    C12: "=",
    D12: "",
    E12: "",
    B13: "",
    C13: 7,
    D13: "",
    E13: "",
    C14: 7,
    E14: "",
    B15: "",
    C15: 5,
    D15: "",
    E15: "",
    B16: "",
    C16: 10,
    D16: "",
    E16: "",
    B18: 25,
    C18: "≤",
    D18: "",
    E18: "",
    B22: "",
    C22: 0.5,
    D22: "",
    E22: "",
    B23: "",
    D23: "",
    E23: "",
    B24: "",
    D24: "",
    E24: "",
    B25: "",
    C25: "",
    D25: "",
    E25: "",
    B26: "",
    D26: "",
    E26: "",
    B27: "",
    D27: "",
    E27: "",
    B28: "",
    D28: "",
    E28: "",
    B29: "",
    D29: "",
    E29: "",
    B30: "",
    C30: "",
    D30: "",
    E30: "",
    B31: "",
    D31: "",
    E31: "",
    B32: "",
    D32: "",
    E32: "",
    B36: "",
    C36: 5,
    D36: "",
    E36: "",
    B37: "",
    C37: 2.5,
    D37: "",
    E37: "",
    B38: "",
    D38: "",
    E38: "",
    B39: "",
    C39: 0.1,
    D39: "",
    E39: "",
    B40: "",
    C40: 5,
    D40: "",
    E40: "",
    B41: 80,
    C41: "≤",
    D41: "",
    E41: "",
    B45: 25,
    C45: "≤",
    D45: "",
    E45: "",
    B46: "",
    C46: 2,
    D46: "",
    E46: "",
    B49: false,
    D49: false,
    F49: false,
    B50: false,
    D50: false,
    F50: false,
    B51: false,
    D51: false,
    F51: false,
    B52: "",
    G52: "",
  };
}

export function cellsFromData(data: unknown): Record<string, CellValue> {
  const base = blankCells();
  if (!data || typeof data !== "object") return base;
  const cells = (data as { cells?: unknown }).cells;
  if (!cells || typeof cells !== "object") return base;
  for (const [key, value] of Object.entries(cells as Record<string, unknown>)) {
    // Formula cells are recalculated from inputs. A cached -20 is not a saved answer.
    if (key in FORMULA_TEXT) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") base[key] = value;
    else if (value === null) base[key] = "";
  }
  return base;
}

export function parseInput(raw: string): CellValue {
  const trimmed = raw.trim();
  if (trimmed === "") return "";
  if (trimmed === "<=") return "≤";
  if (trimmed === ">=") return "≥";
  if (trimmed === "≤" || trimmed === "≥" || trimmed === "=") return trimmed;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return raw;
}

function isErr(v: unknown): v is typeof ERR_DIV | typeof ERR_VALUE {
  return v === ERR_DIV || v === ERR_VALUE;
}

/** Blank counts as 0. A non-numeric string is null (not a number). */
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

function arith(a: Value, b: Value, op: (x: number, y: number) => number | string): number | string {
  const x = num(a);
  const y = num(b);
  if (typeof x === "string") return x;
  if (typeof y === "string") return y;
  return op(x, y);
}

function div(a: Value, b: Value): number | string {
  return arith(a, b, (x, y) => (y === 0 ? ERR_DIV : x / y));
}

function isBlank(v: Value): boolean {
  return v === null || v === undefined || v === "";
}

/** A measurement. Blank stays blank. It is not zero. */
function filledNumber(v: Value): number | string | null {
  if (isBlank(v)) return null;
  if (isErr(v)) return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : ERR_VALUE;
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (t === "") return null;
  if (/^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return null;
}

/**
 * Min length is max minus stroke for that same column.
 * Both source cells have to be filled. A nominal or sample on another row does not stand in for the missing one.
 */
function subtractFilled(a: Value, b: Value): number | string {
  const x = filledNumber(a);
  const y = filledNumber(b);
  if (x === null || y === null) return "";
  if (typeof x === "string") return x;
  if (typeof y === "string") return y;
  return x - y;
}

type LimitKind = "le" | "ge" | "eq" | "num" | "blank" | "bad";

function limitKind(raw: Value): LimitKind {
  if (isBlank(raw)) return "blank";
  if (typeof raw === "number") return Number.isFinite(raw) ? "num" : "bad";
  if (typeof raw !== "string") return "bad";
  const t = raw.trim();
  if (t === "≤" || t === "<=" || t === "<") return "le";
  if (t === "≥" || t === ">=" || t === ">") return "ge";
  if (t === "=") return "eq";
  if (/^(?:±|\+\/-)\s*\d+(\.\d+)?$/.test(t)) return "num";
  if (/^-?\d+(\.\d+)?$/.test(t)) return "num";
  return "bad";
}

function toleranceSpan(raw: Value): number | string | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? Math.abs(raw) : ERR_VALUE;
  if (typeof raw !== "string") return ERR_VALUE;
  const t = raw.trim().replace(/^(?:±|\+\/-)\s*/, "");
  if (/^-?\d+(\.\d+)?$/.test(t)) return Math.abs(Number(t));
  return ERR_VALUE;
}

/**
 * Pass/Fail from the tolerance cell.
 * ≤ is a maximum, ≥ is a minimum, = matches the nominal, and a number is ±.
 * A blank sample or a blank tolerance stays blank. It is not a failure.
 */
function judge(sample: Value, nominal: Value, tol: Value): string {
  if (isBlank(sample) || isErr(sample)) return isErr(sample) ? sample : "";
  const kind = limitKind(tol);
  if (kind === "blank") return "";
  const actual = filledNumber(sample);
  if (actual === null) return ERR_VALUE;
  if (typeof actual === "string") return actual;
  const limit = filledNumber(nominal);
  if (limit === null) return "";
  if (typeof limit === "string") return limit;
  if (kind === "le") return actual <= limit ? "Passed" : "Failed";
  if (kind === "ge") return actual >= limit ? "Passed" : "Failed";
  if (kind === "eq") return actual === limit ? "Passed" : "Failed";
  if (kind === "bad") return ERR_VALUE;
  const span = toleranceSpan(tol);
  if (span === null) return "";
  if (typeof span === "string") return span;
  return actual >= limit - span && actual <= limit + span ? "Passed" : "Failed";
}

export function evaluate(cells: Record<string, CellValue>): Record<string, CellValue> {
  const computed: Record<string, CellValue> = {};
  const inputs: Record<string, CellValue> = {};
  for (const [addr, value] of Object.entries(cells)) {
    if (addr in FORMULA_TEXT) continue;
    inputs[addr] = value;
  }
  const read = (addr: string): Value => {
    if (Object.prototype.hasOwnProperty.call(computed, addr)) return computed[addr] ?? null;
    const v = inputs[addr];
    if (v === undefined || v === "") return null;
    return v;
  };

  computed.B14 = subtractFilled(read("B13"), read("B15"));
  computed.D14 = subtractFilled(read("D13"), read("D15"));
  computed.B17 = div(read("B16"), read("B15"));
  computed.D17 = div(read("D16"), read("D15"));
  computed.E17 = div(read("E16"), read("E15"));
  const scored: Array<[string, string, string, string]> = [
    ["F12", "D12", "B12", "C12"],
    ["G12", "E12", "B12", "C12"],
    ["F13", "D13", "B13", "C13"],
    ["G13", "E13", "B13", "C13"],
    ["F14", "D14", "B14", "C14"],
    ["F15", "D15", "B15", "C15"],
    ["F16", "D16", "B16", "C16"],
    ["F18", "D18", "B18", "C18"],
    ["G18", "E18", "B18", "C18"],
    ["F22", "D22", "B22", "C22"],
    ["F25", "D25", "B25", "C25"],
    ["F30", "D30", "B30", "C30"],
    ["F36", "D36", "B36", "C36"],
    ["F37", "D37", "B37", "C37"],
    ["F39", "D39", "B39", "C39"],
    ["F40", "D40", "B40", "C40"],
    ["F41", "D41", "B41", "C41"],
    ["G41", "E41", "B41", "C41"],
    ["F45", "D45", "B45", "C45"],
    ["G45", "E45", "B45", "C45"],
    ["F46", "D46", "B46", "C46"],
    ["G46", "E46", "B46", "C46"],
  ];
  for (const [result, sample, nominal, tol] of scored) {
    computed[result] = judge(read(sample), read(nominal), read(tol));
  }

  let failed = 0;
  const seen = new Set<string>();
  const consider = (addr: string, val: Value) => {
    if (!/^[FG]\d+$/.test(addr)) return;
    if (typeof val === "string" && val.toLowerCase() === "failed") failed += 1;
  };
  for (const [addr, val] of Object.entries(computed)) {
    seen.add(addr);
    consider(addr, val);
  }
  for (const [addr, val] of Object.entries(inputs)) {
    if (seen.has(addr)) continue;
    consider(addr, val);
  }
  computed.A1 = failed > 0 ? "Failed" : "Passed";
  return computed;
}

export function showValue(addr: string, value: Value): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return ERR_VALUE;
    if (PERCENT.has(addr)) return `${Math.round(value * 100)}%`;
    const rounded = Math.round(value * 1e8) / 1e8;
    return String(rounded);
  }
  return value;
}

/** Columns F and G from row 2 down, skipping G6, G52, and row 53, plus A1. */
export function inPassFailRange(addr: string): boolean {
  if (addr === "A1") return true;
  const match = /^([A-Z]+)(\d+)$/.exec(addr);
  if (!match) return false;
  const col = match[1]!;
  const row = Number(match[2]);
  if (col !== "F" && col !== "G") return false;
  if (row === 53) return false;
  if (row >= 2 && row <= 5) return true;
  if (row === 6) return col === "F";
  if (row >= 7 && row <= 51) return true;
  if (row === 52) return col === "F";
  if (row >= 54) return true;
  return false;
}

/**
 * Conditional formatting. A1 checks Passed first (priority 1), then Failed.
 * The F/G range checks Failed first (priority 3), then Passed.
 * Match is case-insensitive, same as Excel SEARCH.
 */
export function conditionalFill(addr: string, text: string): string | null {
  const hasPassed = text.toLowerCase().includes("passed");
  const hasFailed = text.toLowerCase().includes("failed");
  if (addr === "A1") {
    if (hasPassed) return PASSED_FILL;
    if (hasFailed) return FAILED_FILL;
    return null;
  }
  if (!inPassFailRange(addr)) return null;
  if (hasFailed) return FAILED_FILL;
  if (hasPassed) return PASSED_FILL;
  return null;
}

export function overallResult(cells: Record<string, CellValue>): string {
  const value = evaluate(cells).A1;
  return typeof value === "string" ? value : "";
}

/** A filled sheet that passes every scored row. */
export function passingExample(): Record<string, CellValue> {
  const cells = blankCells();
  cells.B6 = "CSA-100";
  cells.F6 = "DWG-100";
  cells.B7 = "Sensen";
  cells.F7 = "BATCH-1";
  cells.B8 = "Maxwell Tollefson";
  cells.F8 = "2026-03-26";
  cells.D12 = 10;
  cells.E12 = 10;
  cells.B13 = 320;
  cells.D13 = 320;
  cells.E13 = 318;
  cells.B15 = 140;
  cells.D15 = 140;
  cells.E15 = 138;
  cells.B16 = 70;
  cells.D16 = 70;
  cells.E16 = 68;
  cells.D18 = 18;
  cells.E18 = 22;
  cells.B22 = 12.5;
  cells.D22 = 12.5;
  cells.B25 = 800;
  cells.C25 = 40;
  cells.D25 = 790;
  cells.B30 = 600;
  cells.C30 = 40;
  cells.D30 = 610;
  cells.B36 = 250;
  cells.D36 = 250;
  cells.B37 = 80;
  cells.D37 = 80;
  cells.B39 = 8;
  cells.D39 = 8;
  cells.B40 = 30;
  cells.D40 = 30;
  cells.D41 = 60;
  cells.E41 = 70;
  cells.D45 = 20;
  cells.E45 = 22;
  cells.B46 = 40;
  cells.D46 = 40;
  cells.E46 = 39;
  cells.B49 = true;
  cells.B50 = true;
  cells.B51 = true;
  cells.B52 = "Samples meet the drawing.";
  return cells;
}

/** Same as a passing sheet, with two cells outside the limit so both colors show. */
export function mixedExample(): Record<string, CellValue> {
  const cells = passingExample();
  cells.D12 = 8;
  cells.E18 = 40;
  cells.D49 = true;
  cells.B49 = false;
  return cells;
}
