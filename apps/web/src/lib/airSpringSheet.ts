import { DIMENSIONS, ELECTRONICS, PNEUMATIC, WEIGHTS } from "./airSpringReport";
import type { AirCell, AirKind } from "./airStrutSheet";

export const AIR_SPRING_ROWS = 50;

function cell(col: number, span: number, addr: string, kind: AirKind, extra: Partial<AirCell> = {}): AirCell {
  return { col, span, addr, kind, ...extra };
}

const label = (col: number, span: number, addr: string, text: string, size?: AirCell["size"]) => cell(col, span, addr, "label", { text, size });
const input = (col: number, span: number, addr: string, extra: Partial<AirCell> = {}) => cell(col, span, addr, "input", extra);
const calc = (col: number, span: number, addr: string, extra: Partial<AirCell> = {}) => cell(col, span, addr, "calc", extra);
const across = (addr: string, text: string, size?: AirCell["size"]) => [label(1, 8, addr, text, size)];

function criterion(row: number, text: string, numeric: boolean): AirCell[] {
  return [label(1, 1, `A${row}`, text), input(2, 2, `B${row}`, { numeric }), input(4, 2, `D${row}`, { numeric }), input(6, 2, `F${row}`, { numeric }), calc(8, 1, `H${row}`)];
}

function headers(row: number): AirCell[] {
  return [label(1, 1, `A${row}`, "Criteria"), label(2, 2, `B${row}`, "Nominal"), label(4, 2, `D${row}`, "Tolerances"), label(6, 2, `F${row}`, "Sample"), label(8, 1, `H${row}`, "Pass/Fail")];
}

export function buildAirSpringRows(): AirCell[][] {
  const rows: AirCell[][] = [];
  rows[1] = [label(1, 8, "A1", "AIR SPRING VALIDATION DOCUMENT", "title")];
  rows[2] = [label(1, 1, "A2", "Doc ID:"), label(2, 2, "B2", "Rev: A"), label(4, 2, "D2", "Effective Date: 09/30/2026"), label(6, 1, "F2", "Approved By:"), input(7, 2, "G2")];
  rows[3] = across("A3", "Purpose: To validate incoming First Article or production of Air Springs against the approved DMA engineering drawing", "note");
  rows[4] = [cell(1, 8, "A4", "spacer")];
  rows[5] = across("A5", "1.0 PROJECT & VEHICLE INFORMATION", "section");
  rows[6] = [label(1, 1, "A6", "DMA Part Number:"), input(2, 2, "B6"), label(4, 1, "D6", "Drawing Number:"), input(5, 2, "E6"), label(7, 2, "G6", "PASS / FAIL")];
  rows[7] = [label(1, 1, "A7", "Supplier / Factory:"), input(2, 2, "B7"), label(4, 1, "D7", "Batch/PO Number:"), input(5, 2, "E7"), calc(7, 2, "G7", { size: "result", rowSpan: 3 })];
  rows[8] = [label(1, 1, "A8", "Inspected By:"), input(2, 2, "B8"), label(4, 1, "D8", "Inspection Date:"), input(5, 2, "E8", { inputType: "date" })];
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
  rows[29] = [label(1, 1, "A29", "Calculated Ride Height PSI:"), calc(2, 2, "B29"), input(4, 2, "D29", { numeric: true }), calc(6, 2, "F29"), calc(8, 1, "H29")];
  rows[30] = [label(1, 1, "A30", "Calculated Ride Height PSI Spring Rate (N/mm):"), calc(2, 2, "B30"), input(4, 2, "D30", { numeric: true }), calc(6, 2, "F30"), calc(8, 1, "H30")];
  rows[31] = [cell(1, 8, "A31", "spacer")];
  rows[32] = across("A32", "5.0 ELECTRONICS & HARDWARE", "section");
  rows[33] = [label(2, 3, "B33", "Nominal"), label(5, 3, "E33", "Sample"), label(8, 1, "H33", "Pass/Fail")];
  for (const item of ELECTRONICS) {
    rows[item.row] = [label(1, 1, `A${item.row}`, item.label), input(2, 3, `B${item.row}`), input(5, 3, `E${item.row}`), calc(8, 1, `H${item.row}`)];
  }
  rows[41] = [cell(1, 8, "A41", "spacer")];
  rows[42] = across("A42", "6.0 WEIGHTS & PACKAGING", "section");
  rows[43] = [label(1, 1, "A43", "Component"), label(2, 2, "B43", "Nominal"), label(4, 2, "D43", "Sample"), label(6, 2, "F43", "Pass/Fail"), label(8, 1, "H43", "Notes")];
  for (const item of WEIGHTS) {
    rows[item.row] = [label(1, 1, `A${item.row}`, item.label), input(2, 2, `B${item.row}`), input(4, 2, `D${item.row}`), calc(6, 2, `F${item.row}`), input(8, 1, `H${item.row}`)];
  }
  rows[47] = [cell(1, 8, "A47", "spacer")];
  rows[48] = [label(1, 1, "A48", "FINAL DISPOSITION:"), calc(2, 4, "B48", { size: "result" }), cell(6, 3, "F48", "check", { text: "APPROVED WITH DEVIATION" })];
  rows[49] = [label(1, 1, "A49", "Authorized By (Signature):"), cell(2, 7, "B49", "sign")];
  rows[50] = [label(1, 1, "A50", "Deviation/Rejection Notes:"), cell(2, 7, "B50", "area")];
  return rows;
}
