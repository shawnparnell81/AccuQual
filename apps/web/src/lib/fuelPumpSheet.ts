import { FLOW_NOTE, PACK_NOTE, REVIEW_NOTE, YN_OPTIONS } from "./fuelPumpReport";

export type FuelKind = "label" | "input" | "calc" | "check" | "select" | "area" | "blocked" | "spacer";

export interface FuelCell {
  col: number;
  span: number;
  addr: string;
  kind: FuelKind;
  text?: string;
  size?: "title" | "section" | "note" | "result";
  inputType?: "text" | "date";
  numeric?: boolean;
}

function cell(col: number, span: number, addr: string, kind: FuelKind, extra: Partial<FuelCell> = {}): FuelCell {
  return { col, span, addr, kind, ...extra };
}

const label = (col: number, span: number, addr: string, text: string, size?: FuelCell["size"]) =>
  cell(col, span, addr, "label", { text, size });
const input = (col: number, span: number, addr: string, extra: Partial<FuelCell> = {}) => cell(col, span, addr, "input", extra);
const calc = (col: number, span: number, addr: string, size?: FuelCell["size"]) => cell(col, span, addr, "calc", { size });
const select = (col: number, span: number, addr: string) => cell(col, span, addr, "select");
const check = (col: number, span: number, addr: string) => cell(col, span, addr, "check");
const blocked = (col: number, addr: string) => cell(col, 1, addr, "blocked");
const area = (col: number, span: number, addr: string) => cell(col, span, addr, "area");

function section(addr: string, text: string): FuelCell[] {
  return [label(1, 8, addr, text, "section")];
}

function across(addr: string, text: string, size?: FuelCell["size"]): FuelCell[] {
  return [label(1, 8, addr, text, size)];
}

function dimensional(row: number): FuelCell[] {
  return [
    input(1, 1, `A${row}`),
    input(2, 2, `B${row}`, { numeric: true }),
    input(4, 1, `D${row}`, { numeric: true }),
    calc(5, 1, `E${row}`),
    calc(6, 1, `F${row}`),
    input(7, 1, `G${row}`, { numeric: true }),
    calc(8, 1, `H${row}`),
  ];
}

function headers(row: number, labels: Array<[number, number, string]>): FuelCell[] {
  return labels.map(([col, span, text]) => label(col, span, `${"ABCDEFGHIJKLM"[col - 1]}${row}`, text));
}

export function buildFuelPumpRows(): FuelCell[][] {
  const rows: FuelCell[][] = [];
  rows[1] = [label(1, 8, "A1", "FUEL PUMP VALIDATION DOCUMENT", "title"), label(10, 2, "J1", "Sample Pass/Fail")];
  rows[2] = [
    label(1, 1, "A2", "Doc ID:"),
    label(2, 3, "B2", "Rev: C"),
    label(5, 1, "E2", "Effective Date:"),
    input(6, 1, "F2", { inputType: "date" }),
    label(7, 1, "G2", "Approved By:"),
    input(8, 1, "H2"),
    calc(10, 2, "J2", "result"),
  ];
  rows[3] = across("A3", "Purpose: To validate incoming First Article or production Fuel Pumps against the approved DMA engineering drawing.", "note");
  rows[4] = across("A4", "");
  rows[5] = section("A5", "1.0 PART & INSPECTION INFORMATION");
  rows[6] = [
    label(1, 1, "A6", "Selling Part Number:"),
    input(2, 3, "B6"),
    label(5, 2, "E6", "Drawing Part Number:"),
    input(7, 2, "G6"),
  ];
  rows[7] = [
    label(1, 1, "A7", "Supplier / Factory:"),
    input(2, 3, "B7"),
    label(5, 2, "E7", "Batch Number:"),
    input(7, 2, "G7"),
  ];
  rows[8] = [
    label(1, 1, "A8", "Inspected By:"),
    input(2, 3, "B8"),
    label(5, 2, "E8", "Inspection Date:"),
    input(7, 2, "G8", { inputType: "date" }),
  ];
  rows[9] = across("A9", "");
  rows[10] = section("A10", "2.0 DIMENSIONAL PARAMETERS");
  rows[11] = across(
    "A11",
    "***Parameter names are general and may need to be adjusted for individual drawings. If all rows are not used label as NA. Extra blank rows are provided for additional dimensions as needed.***",
    "note",
  );
  rows[12] = [
    label(1, 1, "A12", "Parameter [mm]"),
    label(2, 2, "B12", "Nominal"),
    label(4, 1, "D12", "Tolerance"),
    label(5, 1, "E12", "Min"),
    label(6, 1, "F12", "Max"),
    label(7, 1, "G12", "Sample"),
    label(8, 1, "H12", "RESULT"),
    cell(12, 2, "L12", "spacer"),
  ];
  for (let row = 13; row <= 24; row += 1) rows[row] = dimensional(row);
  rows[13]!.push(cell(12, 2, "L13", "spacer"));
  rows[25] = across("A25", "");
  rows[26] = section("A26", "3.0 DYNAMIC PARAMETERS");
  rows[27] = across("A27", FLOW_NOTE, "note");
  rows[28] = headers(28, [
    [1, 1, "Parameter"],
    [2, 1, "Nominal"],
    [3, 1, " Minimum? (ex ≥120) Y/N"],
    [4, 1, "Flow Tolerance Range? (ex 130-170)"],
    [5, 1, "Min"],
    [6, 1, "Max"],
    [7, 1, "Sample"],
    [8, 1, "RESULT"],
  ]);
  rows[29] = [label(1, 1, "A29", "Test Pressure [kPa]"), input(2, 7, "B29")];
  rows[30] = [
    label(1, 1, "A30", "Min flow rate (at test presure) [lph]"),
    input(2, 1, "B30", { numeric: true }),
    select(3, 1, "C30"),
    calc(4, 1, "D30"),
    calc(5, 1, "E30"),
    calc(6, 1, "F30"),
    input(7, 1, "G30", { numeric: true }),
    calc(8, 1, "H30"),
  ];
  rows[31] = [
    label(1, 1, "A31", "Shutoff pressure [kPa]"),
    input(2, 1, "B31", { numeric: true }),
    select(3, 1, "C31"),
    calc(4, 1, "D31"),
    calc(5, 1, "E31"),
    calc(6, 1, "F31"),
    input(7, 1, "G31", { numeric: true }),
    calc(8, 1, "H31"),
  ];
  rows[32] = [
    label(1, 1, "A32", "F Resistance (Full) [Ohms]"),
    input(2, 1, "B32", { numeric: true }),
    blocked(3, "C32"),
    input(4, 1, "D32", { numeric: true }),
    calc(5, 1, "E32"),
    calc(6, 1, "F32"),
    input(7, 1, "G32", { numeric: true }),
    calc(8, 1, "H32"),
  ];
  rows[33] = [
    label(1, 1, "A33", "E Resistance (Empty) [Ohms]"),
    input(2, 1, "B33", { numeric: true }),
    blocked(3, "C33"),
    input(4, 1, "D33", { numeric: true }),
    calc(5, 1, "E33"),
    calc(6, 1, "F33"),
    input(7, 1, "G33", { numeric: true }),
    calc(8, 1, "H33"),
  ];
  rows[34] = [
    label(1, 1, "A34", "Hardware included"),
    input(2, 1, "B34"),
    blocked(3, "C34"),
    label(4, 1, "D34", "NA"),
    label(5, 1, "E34", "NA"),
    label(6, 1, "F34", "NA"),
    select(7, 1, "G34"),
    calc(8, 1, "H34"),
  ];
  rows[35] = across("A35", "");
  rows[36] = section("A36", "4.0 VISUAL AND FUNCTIONAL CHECKS");
  rows[37] = [
    label(1, 1, "A37", "Parameter"),
    label(2, 5, "B37", "Requirement"),
    label(7, 1, "G37", "Sample"),
    label(8, 1, "H37", "RESULT"),
  ];
  const checks: Array<[number, string, string]> = [
    [38, "Pressure hold", "Must Hold (Y)"],
    [39, "Continuity", "Must Have Continuity (Y)"],
    [40, "Pinout Matches Drawing", "Must Match Drawing (Y)"],
    [41, "Overall Visual Match", "Must Match Drawing (Y)"],
  ];
  for (const [row, name, requirement] of checks) {
    rows[row] = [label(1, 1, `A${row}`, name), label(2, 5, `B${row}`, requirement), select(7, 1, `G${row}`), calc(8, 1, `H${row}`)];
  }
  rows[42] = across("A42", "");
  rows[43] = section("A43", "5.0 PACKAGING");
  rows[44] = across("A44", PACK_NOTE, "note");
  rows[45] = [
    label(1, 1, "A45", "Parameter [mm]"),
    label(2, 2, "B45", "Nominal"),
    label(4, 1, "D45", "Tolerance"),
    label(5, 1, "E45", "Min"),
    label(6, 1, "F45", "Max"),
    label(7, 1, "G45", "Sample"),
    label(8, 1, "H45", "RESULT"),
  ];
  const packs: Array<[number, string]> = [
    [46, "Length "],
    [47, "Width "],
    [48, "Height "],
  ];
  for (const [row, name] of packs) {
    rows[row] = [
      label(1, 1, `A${row}`, name),
      input(2, 2, `B${row}`, { numeric: true }),
      calc(4, 1, `D${row}`),
      calc(5, 1, `E${row}`),
      calc(6, 1, `F${row}`),
      input(7, 1, `G${row}`, { numeric: true }),
      calc(8, 1, `H${row}`),
    ];
  }
  rows[49] = across("A49", "");
  rows[50] = section("A50", "6.0 Evaluation");
  rows[51] = [label(1, 1, "A51", "Pass/Fail"), calc(2, 7, "B51", "result")];
  rows[52] = disposition("A52");
  rows[53] = [label(1, 1, "A53", "Authorized By (Signature):"), input(2, 7, "B53")];
  rows[54] = [label(1, 1, "A54", "Deviation/Rejection Notes:"), area(2, 7, "B54")];
  rows[55] = across("A55", "");
  rows[56] = section("A56", "7.0 Furthur Review");
  rows[57] = across("A57", REVIEW_NOTE, "note");
  rows[58] = [label(1, 1, "A58", "Pass/Fail"), input(2, 7, "B58")];
  rows[59] = disposition("A59");
  rows[60] = [label(1, 1, "A60", "Authorized By (Signature):"), input(2, 7, "B60")];
  rows[61] = [label(1, 1, "A61", "Approval Notes:"), area(2, 7, "B61")];
  return rows.slice(1);
}

function disposition(addr: "A52" | "A59"): FuelCell[] {
  const row = addr === "A52" ? 52 : 59;
  return [
    label(1, 1, addr, "FINAL DISPOSITION:"),
    label(2, 1, `B${row}`, "APPROVED"),
    check(3, 1, `C${row}`),
    label(4, 1, `D${row}`, "REJECTED"),
    check(5, 1, `E${row}`),
    label(6, 2, `F${row}`, "APPROVED WITH DEVIATION"),
    check(8, 1, `H${row}`),
  ];
}

export const FUEL_YN = YN_OPTIONS;
