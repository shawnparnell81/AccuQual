import {
  DAMPING_STATES,
  DIMENSIONS,
  ELECTRONICS,
  PNEUMATIC,
  VELOCITIES,
  VELOCITY_COLS,
  WEIGHTS,
} from "./airStrutReport";

export type AirKind = "label" | "input" | "calc" | "check" | "area" | "sign" | "spacer";

export interface AirCell {
  col: number;
  span: number;
  rowSpan?: number;
  addr: string;
  kind: AirKind;
  text?: string;
  size?: "title" | "section" | "note" | "result";
  inputType?: "text" | "date";
  numeric?: boolean;
}

export const AIR_STRUT_ROWS = 86;

function cell(col: number, span: number, addr: string, kind: AirKind, extra: Partial<AirCell> = {}): AirCell {
  return { col, span, addr, kind, ...extra };
}

const label = (col: number, span: number, addr: string, text: string, size?: AirCell["size"]) => cell(col, span, addr, "label", { text, size });
const input = (col: number, span: number, addr: string, extra: Partial<AirCell> = {}) => cell(col, span, addr, "input", extra);
const calc = (col: number, span: number, addr: string, extra: Partial<AirCell> = {}) => cell(col, span, addr, "calc", extra);
const across = (addr: string, text: string, size?: AirCell["size"]) => [label(1, 8, addr, text, size)];

function criterion(row: number, text: string, numeric: boolean): AirCell[] {
  return [
    label(1, 1, `A${row}`, text),
    input(2, 2, `B${row}`, { numeric }),
    input(4, 2, `D${row}`, { numeric }),
    input(6, 2, `F${row}`, { numeric }),
    calc(8, 1, `H${row}`),
  ];
}

function headers(row: number): AirCell[] {
  return [
    label(1, 1, `A${row}`, "Criteria"),
    label(2, 2, `B${row}`, "Nominal"),
    label(4, 2, `D${row}`, "Tolerances"),
    label(6, 2, `F${row}`, "Sample"),
    label(8, 1, `H${row}`, "Pass/Fail"),
  ];
}

export function buildAirStrutRows(): AirCell[][] {
  const rows: AirCell[][] = [];
  rows[1] = [label(1, 8, "A1", "AIR STRUT VALIDATION DOCUMENT", "title")];
  rows[2] = [
    label(1, 1, "A2", "Doc ID:"),
    label(2, 2, "B2", "Rev: A"),
    label(4, 2, "D2", "Effective Date: 09/04/2026"),
    label(6, 1, "F2", "Approved By:"),
    input(7, 2, "G2"),
  ];
  rows[3] = across("A3", "Purpose: To validate incoming First Article or production of Air Struts against the approved DMA engineering drawing", "note");
  rows[4] = [cell(1, 8, "A4", "spacer")];
  rows[5] = across("A5", "1.0 PROJECT & VEHICLE INFORMATION", "section");
  rows[6] = [
    label(1, 1, "A6", "DMA Part Number:"),
    input(2, 2, "B6"),
    label(4, 1, "D6", "Drawing Number:"),
    input(5, 2, "E6"),
    label(7, 2, "G6", "PASS / FAIL"),
  ];
  rows[7] = [
    label(1, 1, "A7", "Supplier / Factory:"),
    input(2, 2, "B7"),
    label(4, 1, "D7", "Batch/PO Number:"),
    input(5, 2, "E7"),
    calc(7, 2, "G7", { size: "result", rowSpan: 3 }),
  ];
  rows[8] = [
    label(1, 1, "A8", "Inspected By:"),
    input(2, 2, "B8"),
    label(4, 1, "D8", "Inspection Date:"),
    input(5, 2, "E8", { inputType: "date" }),
  ];
  rows[9] = [
    label(1, 1, "A9", "Vehicle Weight (lbs):"),
    input(2, 1, "B9", { numeric: true }),
    label(3, 1, "C9", "Weight Distribution (%):"),
    input(4, 1, "D9", { numeric: true }),
    label(5, 1, "E9", "Motion Ratio:"),
    input(6, 1, "F9", { numeric: true }),
  ];
  rows[10] = [cell(1, 8, "A10", "spacer")];
  rows[11] = across("A11", "2.0 PHYSICAL DIMENSIONS & CONSTRUCTION", "section");
  rows[12] = headers(12);
  for (const item of DIMENSIONS) rows[item.row] = criterion(item.row, item.label, !item.text);
  rows[21] = [cell(1, 8, "A21", "spacer")];
  rows[22] = across("A22", "3.0 PNEUMATIC SPRING RATE & FORCE", "section");
  rows[23] = headers(23);
  for (const item of PNEUMATIC) rows[item.row] = criterion(item.row, item.label, true);
  rows[28] = [label(1, 1, "A28", "Target Ride Height Force:"), calc(2, 7, "B28")];
  rows[29] = [
    label(1, 1, "A29", "Calculated Ride Height PSI:"),
    calc(2, 2, "B29"),
    input(4, 2, "D29", { numeric: true }),
    calc(6, 2, "F29"),
    calc(8, 1, "H29"),
  ];
  rows[30] = [
    label(1, 1, "A30", "Calculated Ride Height PSI Spring Rate (N/mm):"),
    calc(2, 2, "B30"),
    input(4, 2, "D30", { numeric: true }),
    calc(6, 2, "F30"),
    calc(8, 1, "H30"),
  ];
  rows[31] = [cell(1, 8, "A31", "spacer")];
  rows[32] = across("A32", "4.0 DAMPING FORCE TEST (CTW DYNO / JASO C602)", "section");
  rows[33] = [
    label(2, 1, "B33", "Current State"),
    label(3, 1, "C33", "Velocity (m/s)"),
    ...VELOCITIES.map((velocity, index) => label(4 + index, 1, `${VELOCITY_COLS[index]}33`, velocity)),
  ];
  for (const state of DAMPING_STATES) {
    rows[state.nominalComp] = [
      label(1, 1, `A${state.nominalComp}`, "Nominal"),
      input(2, 1, state.amp, { rowSpan: 4 }),
      label(3, 1, `C${state.nominalComp}`, "Compression Force (N)"),
      ...VELOCITY_COLS.map((col) => input(colNum(col), 1, `${col}${state.nominalComp}`, { numeric: true })),
    ];
    rows[state.nominalReb] = [
      label(3, 1, `C${state.nominalReb}`, "Rebound Force (N)"),
      ...VELOCITY_COLS.map((col) => input(colNum(col), 1, `${col}${state.nominalReb}`, { numeric: true })),
    ];
    rows[state.sampleComp] = [
      label(1, 1, `A${state.sampleComp}`, "Sample"),
      label(3, 1, `C${state.sampleComp}`, "Compression Force (N)"),
      ...VELOCITY_COLS.map((col) => input(colNum(col), 1, `${col}${state.sampleComp}`, { numeric: true })),
    ];
    rows[state.sampleReb] = [
      label(3, 1, `C${state.sampleReb}`, "Rebound Force (N)"),
      ...VELOCITY_COLS.map((col) => input(colNum(col), 1, `${col}${state.sampleReb}`, { numeric: true })),
    ];
    rows[state.tolComp] = [
      label(1, 1, `A${state.tolComp}`, "Compression Tolerance"),
      ...VELOCITY_COLS.map((col) => input(colNum(col), 1, `${col}${state.tolComp}`, { numeric: true })),
    ];
    rows[state.tolReb] = [
      label(1, 1, `A${state.tolReb}`, "Rebound Tolerance"),
      ...VELOCITY_COLS.map((col) => input(colNum(col), 1, `${col}${state.tolReb}`, { numeric: true })),
    ];
    rows[state.passComp] = [
      label(1, 1, `A${state.passComp}`, "Compression Pass / Fail"),
      ...VELOCITY_COLS.map((col) => calc(colNum(col), 1, `${col}${state.passComp}`)),
    ];
    rows[state.passReb] = [
      label(1, 1, `A${state.passReb}`, "Rebound Pass / Fail"),
      ...VELOCITY_COLS.map((col) => calc(colNum(col), 1, `${col}${state.passReb}`)),
    ];
  }
  rows[66] = [cell(1, 8, "A66", "spacer")];
  rows[67] = across("A67", "5.0 ELECTRONICS & HARDWARE", "section");
  rows[68] = [label(2, 3, "B68", "Nominal"), label(5, 3, "E68", "Sample"), label(8, 1, "H68", "Pass/Fail")];
  for (const item of ELECTRONICS) {
    rows[item.row] = [label(1, 1, `A${item.row}`, item.label), input(2, 3, `B${item.row}`), input(5, 3, `E${item.row}`), calc(8, 1, `H${item.row}`)];
  }
  rows[76] = [cell(1, 8, "A76", "spacer")];
  rows[77] = across("A77", "6.0 WEIGHTS & PACKAGING", "section");
  rows[78] = [
    label(1, 1, "A78", "Component"),
    label(2, 2, "B78", "Nominal"),
    label(4, 2, "D78", "Sample"),
    label(6, 2, "F78", "Pass/Fail"),
    label(8, 1, "H78", "Notes"),
  ];
  for (const item of WEIGHTS) {
    rows[item.row] = [
      label(1, 1, `A${item.row}`, item.label),
      input(2, 2, `B${item.row}`),
      input(4, 2, `D${item.row}`),
      calc(6, 2, `F${item.row}`),
      input(8, 1, `H${item.row}`),
    ];
  }
  rows[83] = [cell(1, 8, "A83", "spacer")];
  rows[84] = [
    label(1, 1, "A84", "FINAL DISPOSITION:"),
    calc(2, 4, "B84", { size: "result" }),
    cell(6, 3, "F84", "check", { text: "APPROVED WITH DEVIATION" }),
  ];
  rows[85] = [label(1, 1, "A85", "Authorized By (Signature):"), cell(2, 7, "B85", "sign")];
  rows[86] = [label(1, 1, "A86", "Deviation/Rejection Notes:"), cell(2, 7, "B86", "area")];
  return rows;
}

function colNum(col: string): number {
  return col.charCodeAt(0) - 64;
}
