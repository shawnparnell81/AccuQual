import { FILLS, FORMULA_TEXT, INSPECTOR_OPTIONS, SUPPLIER_OPTIONS } from "./validationReport";

export type SheetKind = "label" | "input" | "calc" | "check" | "select" | "area" | "gray" | "empty";

export interface SheetCell {
  col: number;
  span: number;
  rowSpan?: number;
  addr: string;
  kind: SheetKind;
  text?: string;
  fill?: string;
  bold?: boolean;
  size?: "title" | "result" | "section";
  wrap?: boolean;
  options?: string[];
  inputType?: "text" | "date";
}

const GRAY = new Set([
  "G14", "G15", "G16", "C17", "F17", "G17", "G22", "C23", "F23", "G23", "C24", "F24", "G24", "G25",
  "C26", "F26", "G26", "C27", "F27", "G27", "C28", "F28", "G28", "C29", "F29", "G29", "G30", "C31",
  "F31", "G31", "C32", "F32", "G32", "G36", "G37", "C38", "F38", "G38", "G39", "G40",
]);

const TONE: Record<number, string> = {
  12: FILLS.gold,
  13: FILLS.gold,
  15: FILLS.lilac,
  16: FILLS.orange,
  18: FILLS.gold,
  22: FILLS.lilac,
  23: FILLS.green,
  24: FILLS.green,
  25: FILLS.green,
  26: FILLS.green,
  27: FILLS.green,
  28: FILLS.green,
  29: FILLS.green,
  30: FILLS.green,
  31: FILLS.green,
  32: FILLS.green,
  36: FILLS.lilac,
  37: FILLS.lilac,
  38: FILLS.lilac,
  39: FILLS.lilac,
  40: FILLS.orange,
  41: FILLS.gold,
  45: FILLS.gold,
  46: FILLS.lilac,
};

const CRITERIA: Record<number, string> = {
  12: "Hardwear Grade",
  13: "Max Length (Extended) (mm)",
  14: "Min Length (Compressed) (mm)",
  15: "Stroke (mm)",
  16: "Displacement at Ride Height Force (mm)",
  17: "Percent Stroke Used (%)",
  18: "Strut Paint Thickness (µm)",
  22: "Piston Rod Diameter (mm)",
  23: "Compression Force @ 1.0m/s (N)",
  24: "Compression Force @ 0.6m/s (N)",
  25: "Compression Force @ 0.3m/s (N)",
  26: "Compression Force @ 0.1m/s (N)",
  27: "Compression Force @ 0.05m/s (N)",
  28: "Rebound Force @ 0.05m/s (N)",
  29: "Rebound Force @ 0.1m/s (N)",
  30: "Rebound Force @ 0.3m/s (N)",
  31: "Rebound Force @ 0.6m/s (N)",
  32: "Rebound Force @ 1.0m/s (N)",
  36: "Max Length (Free Height) (mm)",
  37: "Outer Diameter (mm)",
  38: "Coil Count (Total)",
  39: "Wire Thickness (mm)",
  40: "Spring Rate (N/mm)",
  41: "Spring Paint Thickness (µm)",
  45: "Mount Paint Thickness (µm)",
  46: "Bump Stop Length (mm)",
};

const CHECKS = new Set(["B49", "D49", "F49", "B50", "D50", "F50", "B51", "D51", "F51"]);

function colLetter(col: number): string {
  return "ABCDEFGHIJ"[col - 1] ?? "A";
}

function addr(col: number, row: number): string {
  return `${colLetter(col)}${row}`;
}

function section(row: number, text: string): SheetCell {
  return { col: 1, span: 7, addr: addr(1, row), kind: "label", text, bold: true, size: "section" };
}

function spacer(row: number): SheetCell {
  return { col: 1, span: 7, addr: addr(1, row), kind: "empty" };
}

function headers(row: number): SheetCell[] {
  const labels = ["Criteria", "Nominal", "Tolorences", "Sample 1", "Sample 2", "Pass / Fail sample 1", "Pass / Fail Sample 2"];
  return labels.map((text, index) => ({
    col: index + 1,
    span: 1,
    addr: addr(index + 1, row),
    kind: "label" as const,
    text,
    bold: true,
  }));
}

function measure(row: number): SheetCell[] {
  const cells: SheetCell[] = [
    {
      col: 1,
      span: 1,
      addr: `A${row}`,
      kind: "label",
      text: CRITERIA[row],
      fill: TONE[row],
    },
  ];
  for (let col = 2; col <= 7; col += 1) {
    const id = addr(col, row);
    if (FORMULA_TEXT[id]) cells.push({ col, span: 1, addr: id, kind: "calc" });
    else if (GRAY.has(id)) cells.push({ col, span: 1, addr: id, kind: "gray" });
    else cells.push({ col, span: 1, addr: id, kind: "input" });
  }
  return cells;
}

function legend(row: number, fill: string | undefined, text: string, wrap = false): SheetCell[] {
  const cells: SheetCell[] = [];
  if (fill) cells.push({ col: 9, span: 1, addr: `I${row}`, kind: "label", text: "", fill });
  cells.push({ col: 10, span: 1, addr: `J${row}`, kind: "label", text, wrap, fill: undefined });
  return cells;
}

function disposition(row: number, label: string): SheetCell[] {
  return [
    { col: 1, span: 1, addr: `A${row}`, kind: "label", text: label },
    { col: 2, span: 1, addr: `B${row}`, kind: "check" },
    { col: 3, span: 1, addr: `C${row}`, kind: "label", text: "Pass" },
    { col: 4, span: 1, addr: `D${row}`, kind: "check" },
    { col: 5, span: 1, addr: `E${row}`, kind: "label", text: "Fail" },
    { col: 6, span: 1, addr: `F${row}`, kind: "check" },
    { col: 7, span: 1, addr: `G${row}`, kind: "label", text: "Conditional Pass" },
  ];
}

/** One entry per sheet row, 1 through 53. Anchor cells only; spans cover the rest. */
export function buildSheetRows(): SheetCell[][] {
  const rows: SheetCell[][] = Array.from({ length: 53 }, () => []);
  const put = (row: number, cells: SheetCell[]) => {
    rows[row - 1] = cells;
  };

  put(1, [
    { col: 1, span: 1, addr: "A1", kind: "calc", size: "result", bold: true },
    { col: 2, span: 6, addr: "B1", kind: "label", text: "CSA VALIDATION REPORT ", size: "title", bold: true },
  ]);
  put(2, [
    { col: 1, span: 1, addr: "A2", kind: "label", text: "Doc ID: FRM-VAL-001" },
    { col: 2, span: 3, addr: "B2", kind: "label", text: "Rev: C" },
    { col: 5, span: 1, addr: "E2", kind: "label", text: "Effective Date: 03/26/2026" },
    { col: 6, span: 1, addr: "F2", kind: "label", text: "Approved By:" },
    { col: 7, span: 1, addr: "G2", kind: "input" },
  ]);
  put(3, [
    {
      col: 1,
      span: 7,
      addr: "A3",
      kind: "label",
      text: "Purpose: To validate incoming First Article or production CSAs against athe approved DMA engineering drawing",
      wrap: true,
    },
  ]);
  put(4, [spacer(4)]);
  put(5, [section(5, "1.0 PART & INSPECTION INFORMATION"), ...legend(5, FILLS.gold, "Measurements before disassembly", true)]);
  put(6, [
    { col: 1, span: 1, addr: "A6", kind: "label", text: "DMA Part Number:" },
    { col: 2, span: 3, addr: "B6", kind: "input" },
    { col: 5, span: 1, addr: "E6", kind: "label", text: "Drawing Number:" },
    { col: 6, span: 2, addr: "F6", kind: "input" },
    ...legend(6, FILLS.orange, "Spring Rater"),
  ]);
  put(7, [
    { col: 1, span: 1, addr: "A7", kind: "label", text: "Supplier / Factory:" },
    { col: 2, span: 3, addr: "B7", kind: "select", options: SUPPLIER_OPTIONS },
    { col: 5, span: 1, addr: "E7", kind: "label", text: "Batch Number:" },
    { col: 6, span: 2, addr: "F7", kind: "input" },
    ...legend(7, FILLS.lilac, "Measurements after disassembly", true),
  ]);
  put(8, [
    { col: 1, span: 1, addr: "A8", kind: "label", text: "Inspected By:" },
    { col: 2, span: 3, addr: "B8", kind: "select", options: INSPECTOR_OPTIONS },
    { col: 5, span: 1, addr: "E8", kind: "label", text: "Inspection Date" },
    { col: 6, span: 2, addr: "F8", kind: "input", inputType: "date" },
    ...legend(8, FILLS.green, "Shock Dyno"),
  ]);
  put(9, [spacer(9), ...legend(9, undefined, "Calculated")]);
  put(10, [section(10, "2.0 STRUT PHYSICALS")]);
  put(11, headers(11));
  for (const row of [12, 13, 14, 15, 16, 17, 18]) put(row, measure(row));
  put(19, [spacer(19)]);
  put(20, [section(20, "3.0 DAMPER PERFORMANCE")]);
  put(21, headers(21));
  for (let row = 22; row <= 32; row += 1) put(row, measure(row));
  put(33, [spacer(33)]);
  put(34, [section(34, "4.0 COIL SPRING")]);
  put(35, headers(35));
  for (let row = 36; row <= 41; row += 1) put(row, measure(row));
  put(42, [spacer(42)]);
  put(43, [section(43, "5.0 MOUNTS & BUMP STOPS")]);
  put(44, headers(44));
  put(45, measure(45));
  put(46, measure(46));
  put(47, [spacer(47)]);
  put(48, [section(48, "6.0 FINAL CONCLUSION")]);
  put(49, disposition(49, "OVERALL DISPOSITION SAMPLE 1:"));
  put(50, disposition(50, "OVERALL DISPOSITION SAMPLE 2:"));
  put(51, disposition(51, "OVERALL DISPOSITION:"));
  put(52, [
    { col: 1, span: 1, rowSpan: 2, addr: "A52", kind: "label", text: "Notes:", bold: true },
    { col: 2, span: 4, rowSpan: 2, addr: "B52", kind: "area" },
    { col: 6, span: 1, rowSpan: 2, addr: "F52", kind: "label", text: "Engineer who Approved Conditional Pass:", wrap: true },
    { col: 7, span: 1, rowSpan: 2, addr: "G52", kind: "input" },
  ]);
  put(53, []);
  return rows;
}

export const CHECKBOX_ADDRS = CHECKS;
