import type { FormCell, FormLayout } from "./isoFormLayouts";
import type { CellValue } from "./isoFormLogic";
import { DEFAULT_INSPECTOR } from "./validationReport";

export const AUDIT_SUMMARY_LEAD = "D5";
export const AUDIT_SCORE = "B13";

export const AUDIT_SIGNATURES = {
  leadAuditorSignature: "I certify that I conducted this audit impartially and according to the internal audit procedure.",
  managementSignature: "I certify that I have reviewed the findings, scores, and triggered corrective actions.",
  auditeeSignature1: "I certify that the immediate correction for this minor finding is complete.",
  auditeeSignature2: "I certify that the immediate correction for this minor finding is complete.",
  auditeeSignature3: "I certify that the immediate correction for this minor finding is complete.",
  auditeeSignature4: "I certify that the immediate correction for this minor finding is complete.",
} as const;

export type AuditSignatureKey = keyof typeof AUDIT_SIGNATURES;

const L = (col: number, span: number, addr: string, text: string, role?: FormCell["role"], align?: FormCell["align"]): FormCell => ({
  col,
  span,
  addr,
  kind: "label",
  text,
  role,
  align,
});
const I = (col: number, span: number, addr: string, placeholder?: string): FormCell => ({ col, span, addr, kind: "input", placeholder });
const D = (col: number, span: number, addr: string): FormCell => ({ col, span, addr, kind: "date" });
const N = (col: number, span: number, addr: string, placeholder?: string): FormCell => ({ col, span, addr, kind: "number", placeholder });
const A = (col: number, span: number, addr: string, placeholder?: string): FormCell => ({ col, span, addr, kind: "area", placeholder });
const sign = (col: number, span: number, addr: string, signatureKey: AuditSignatureKey): FormCell => ({
  col,
  span,
  addr,
  kind: "signature",
  signatureKey,
  certify: AUDIT_SIGNATURES[signatureKey],
});

function numberOf(value: CellValue | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

/** (Passed / Checklist items) * 100. A blank pair stays blank. Zero items is #DIV/0!. */
export function auditScore(cells: Record<string, CellValue>): string {
  const total = numberOf(cells.B11);
  const passed = numberOf(cells.D11);
  if (total == null && passed == null) return "";
  if (total == null || total === 0) return "#DIV/0!";
  if (passed == null) return "";
  const pct = Math.round((passed / total) * 10000) / 100;
  return `${pct}%`;
}

export function auditSummaryStarter(): Record<string, string> {
  return { [AUDIT_SUMMARY_LEAD]: DEFAULT_INSPECTOR };
}

/** PIN stamps live on the record root, next to cells. */
export function auditSignatures(data: unknown): Record<string, string> {
  const source = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const stamps: Record<string, string> = {};
  for (const key of Object.keys(AUDIT_SIGNATURES)) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) stamps[key] = value;
  }
  return stamps;
}

export function auditSummaryLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 6, "A1", "INTERNAL AUDIT SUMMARY REPORT", "title")];
  rows[2] = [
    L(1, 1, "A2", "Doc ID:"),
    { ...L(2, 1, "B2", ""), documentSlot: true },
    L(3, 1, "C2", "Rev:", undefined, "center"),
    L(4, 1, "D2", "A"),
    L(5, 1, "E2", "Title:"),
    L(6, 1, "F2", "Internal Audit Summary Report"),
  ];
  rows[3] = [];
  rows[4] = [L(1, 6, "A4", "1.0 AUDIT INFORMATION", "section")];
  rows[5] = [L(1, 1, "A5", "Date(s) of Audit:"), D(2, 1, "B5"), L(3, 1, "C5", "Lead Auditor:"), I(4, 3, AUDIT_SUMMARY_LEAD, "Auditor name")];
  rows[6] = [L(1, 1, "A6", "Departments Audited:"), I(2, 5, "B6", "e.g. Quality, Engineering")];
  rows[7] = [L(1, 1, "A7", "Audit Scope / Period:"), A(2, 5, "B7", "e.g. H1 bi-annual audit")];
  rows[8] = [];
  rows[9] = [L(1, 6, "A9", "2.0 AUDIT SCORING & RESULTS", "section")];
  rows[10] = [L(1, 6, "A10", "Tally the checklist items assessed on the Internal Audit Checklist and calculate the compliance score.", "note", "left")];
  rows[11] = [
    L(1, 1, "A11", "Total Checklist Items Audited (A):"),
    N(2, 1, "B11", "A"),
    L(3, 1, "C11", "Total Items Passed (B):"),
    N(4, 1, "D11", "B"),
    L(5, 2, "E11", ""),
  ];
  rows[12] = [
    L(1, 1, "A12", "Total Minor Nonconformances (C):"),
    N(2, 1, "B12", "C"),
    L(3, 1, "C12", "Total Major Nonconformances (D):"),
    N(4, 1, "D12", "D"),
    L(5, 2, "E12", ""),
  ];
  rows[13] = [L(1, 1, "A13", "OVERALL COMPLIANCE SCORE ((B / A) * 100):"), { col: 2, span: 2, addr: AUDIT_SCORE, kind: "calc" }, L(4, 3, "D13", "")];
  rows[14] = [];
  rows[15] = [L(1, 6, "A15", "3.0 EXECUTIVE SUMMARY", "section")];
  rows[16] = [L(1, 6, "A16", "Overall QMS Health & Narrative", "note", "left")];
  rows[17] = [A(1, 6, "A17", "Brief summary: areas of excellence, general observations, and systemic trends.")];
  rows[18] = [];
  rows[19] = [L(1, 6, "A19", "4.0 MINOR NONCONFORMANCES & CLOSURES", "section")];
  rows[20] = [L(1, 6, "A20", "Minor findings and opportunities for improvement. The auditee records the immediate correction and signs to close the issue on this report.", "note", "left")];
  rows[21] = [
    L(1, 2, "A21", "Finding Description & ISO Clause", "header"),
    L(3, 2, "C21", "Immediate Correction Taken", "header"),
    L(5, 1, "E21", "Auditee Signature", "header"),
    L(6, 1, "F21", "Date Closed", "header"),
  ];
  const auditeeKeys: AuditSignatureKey[] = ["auditeeSignature1", "auditeeSignature2", "auditeeSignature3", "auditeeSignature4"];
  auditeeKeys.forEach((key, index) => {
    const row = 22 + index;
    rows[row] = [A(1, 2, `A${row}`, `${index + 1}. Finding`), A(3, 2, `C${row}`, "Correction"), sign(5, 1, `E${row}`, key), D(6, 1, `F${row}`)];
  });
  rows[26] = [];
  rows[27] = [L(1, 6, "A27", "5.0 MAJOR NONCONFORMANCES (CAR TRACEABILITY)", "section")];
  rows[28] = [L(1, 6, "A28", "Major nonconformances are a systemic breakdown. Each item listed here must have a formal corrective action for root cause analysis.", "note", "left")];
  rows[29] = [
    L(1, 3, "A29", "Finding Description & ISO Clause", "header"),
    L(4, 1, "D29", "Triggered CAR ID", "header"),
    L(5, 2, "E29", "Assigned Department / Manager", "header"),
  ];
  for (let index = 0; index < 3; index += 1) {
    const row = 30 + index;
    rows[row] = [A(1, 3, `A${row}`, `${index + 1}. Major finding`), I(4, 1, `D${row}`, "CAR ID"), I(5, 2, `E${row}`, "Name / Dept")];
  }
  rows[33] = [];
  rows[34] = [L(1, 6, "A34", "6.0 FINAL APPROVAL & SIGN-OFF", "section")];
  rows[35] = [L(1, 6, "A35", "The lead auditor confirms the audit was conducted impartially. Top management confirms the findings, scores, and triggered corrective actions were reviewed.", "note", "left")];
  rows[36] = [L(1, 1, "A36", "Lead Auditor Signature:"), sign(2, 3, "B36", "leadAuditorSignature"), L(5, 1, "E36", "Date:"), D(6, 1, "F36")];
  rows[37] = [L(1, 1, "A37", "VP of Engineering & Quality:"), sign(2, 3, "B37", "managementSignature"), L(5, 1, "E37", "Date:"), D(6, 1, "F37")];
  rows[38] = [];
  rows[39] = [L(1, 6, "A39", "7.0 REVISION HISTORY", "section")];
  rows[40] = [L(1, 1, "A40", "Rev", "header"), L(2, 1, "B40", "Date", "header"), L(3, 3, "C40", "Description of Change", "header"), L(6, 1, "F40", "Authorized By", "header")];
  for (let index = 0; index < 3; index += 1) {
    const row = 41 + index;
    rows[row] = [I(1, 1, `A${row}`), D(2, 1, `B${row}`), I(3, 3, `C${row}`), I(6, 1, `F${row}`)];
  }
  return { columns: 6, widths: ["22%", "16%", "16%", "16%", "15%", "15%"], rows };
}
