import type { CellValue } from "./isoFormLogic";

export const VISITOR_ROWS = 14;
export const VISITOR_FIRST = 9;

export const VISITOR_COLUMNS = [
  { key: "A", label: "Date", type: "date" },
  { key: "B", label: "Visitor Name", type: "text" },
  { key: "C", label: "Company / Dept", type: "text" },
  { key: "D", label: "Purpose of Visit", type: "text" },
  { key: "E", label: "Escorted By (Employee)", type: "text" },
  { key: "F", label: "Time In", type: "time" },
  { key: "G", label: "Time Out", type: "time" },
  { key: "H", label: "Visitor signature", type: "text" },
  { key: "I", label: "Employee Signature", type: "text" },
] as const;

export const VISITOR_RULES = [
  "1. Confidentiality: You will not disclose any proprietary information, test results, or designs observed within this facility.",
  "2. No Photography: Photography and video recording are strictly prohibited without written authorization.",
  "3. Safety: You agree to follow all safety instructions provided by your escort. Safety glasses must be worn in designated areas.",
  "4. Escort: You must remain with your assigned escort at all times.",
];

export function visitorStarter(): Record<string, string> {
  return { F2: "Lab Entrance", I2: "Maxwell Tollefson" };
}

export function visitorAddr(row: number, column: string): string {
  return `${column}${VISITOR_FIRST + row}`;
}

export function visitorSummary(cells: Record<string, CellValue>): string {
  for (let row = 0; row < VISITOR_ROWS; row += 1) {
    const name = cells[visitorAddr(row, "B")];
    if (typeof name === "string" && name.trim()) return name.trim();
  }
  return "";
}
