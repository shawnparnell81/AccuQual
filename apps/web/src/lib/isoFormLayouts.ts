import { AUDIT_RESULTS, COMPETENCY, YES_NO, YN } from "./isoFormLogic";

export type CellKind = "label" | "input" | "date" | "number" | "select" | "check" | "area" | "calc";

export interface FormCell {
  col: number;
  span: number;
  addr: string;
  kind: CellKind;
  text?: string;
  options?: readonly string[];
  placeholder?: string;
  role?: "title" | "section" | "note" | "header";
  align?: "left" | "center";
  /** Static fill. Selects still pick up pass / minor / major colors on their own. */
  paint?: "fill-green" | "fill-red" | "fill-yellow" | "fill-gray";
}

export interface FormLayout {
  columns: number;
  widths: string[];
  rows: FormCell[][];
}

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
const S = (col: number, span: number, addr: string, options: readonly string[]): FormCell => ({ col, span, addr, kind: "select", options });
const C = (col: number, span: number, addr: string, text: string): FormCell => ({ col, span, addr, kind: "check", text, align: "left" });
const A = (col: number, span: number, addr: string, placeholder?: string): FormCell => ({ col, span, addr, kind: "area", placeholder });
const K = (col: number, span: number, addr: string): FormCell => ({ col, span, addr, kind: "calc" });

const AUDIT_ROWS: Array<[string, string, string, string]> = [
  ["1.0 Management Review", "9.3", "Verify Top Management (VP of Eng & Quality) has conducted a formal Management Review of the QMS. Check minutes to verify CARs, audit results, and QMS performance were reviewed.", "Select 1 (Most recent Management Review record)"],
  ["2.0 Document Control", "7.5", "Verify that lab technicians are using the active, most recent revision of the WIN or TST document during physical testing by cross-referencing LST-GEN-001.", "Select 5 active/recent lab tests"],
  ["3.0 Nonconforming Work", "8.7", "Trace quarantined items from physical segregation through to final disposition using FRM-NCR-002 and the LST-NCW-001 tracker.", "Select 5 random NCR entries from LST-NCW-001"],
  ["3.1 Prototype Failures", "8.3 / 8.7", "Check LST-NCW-001 for development/prototype failures. Verify an NCR was generated and investigate if a CAR was initiated for major development failures.", "Select 3 prototype failures"],
  ["3.2 Corrective Actions", "10.2", "Verify that major failures, rework, or scrap events successfully triggered a formal FRM-CAR-001 or 8D report, and that root cause analysis was documented.", "Select 3 major NCRs or Scrap events"],
  ["4.0 Equipment Calibration", "7.1.5 (17025)", "Pull external calibration certificates for active lab equipment listed on LST-EQP-001. Verify each certificate explicitly includes a statement of 'Measurement Uncertainty'.", "Select 5 external calibration certificates"],
  ["5.0 Lab Test Deviations", "17025", "Review completed lab test reports. If the technician deviated from the standard test method, verify the deviation is recorded in the notes and PHYSICALLY SIGNED/INITIALED by the Engineering Manager.", "Select 5 completed test reports"],
  ["6.0 Design & Development", "8.3", "Review completed product development forms (e.g., FRM-DEV-001, FRM-DEV-004). Verify the Engineering Manager provided final sign-off for BOTH Design Verification and Design Validation.", "Select 3 completed FRM-DEV files"],
  ["7.0 Rework & Repair Plans", "8.5.6", "Review executed WIN-RPN repair plans. Verify any material/visual deviations were formally documented directly in the WIN-RPN and that training sign-offs were completed prior to work.", "Select 3 completed WIN-RPN records"],
];

export function auditLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 6, "A1", "INTERNAL AUDIT CHECKLIST", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID:"), L(2, 1, "B2", "FRM-GEN-001"), L(3, 1, "C2", "Rev:", undefined, "center"), L(4, 1, "D2", "A"), L(5, 1, "E2", "Title:"), L(6, 1, "F2", "Internal Audit Checklist")];
  rows[3] = [L(1, 1, "A3", "Auditor Name:"), I(2, 1, "B3"), L(3, 1, "C3", "Audit Date:", undefined, "center"), D(4, 1, "D3"), L(5, 1, "E3", "Auditee Depts:"), I(6, 1, "F3")];
  rows[4] = [];
  rows[5] = [
    L(1, 1, "A5", "Area / Process", "header"),
    L(2, 1, "B5", "ISO Clause", "header"),
    L(3, 1, "C5", "Audit Verification Action", "header"),
    L(4, 1, "D5", "Strict Sample Size", "header"),
    L(5, 1, "E5", "Findings / Objective Evidence (Record IDs, Notes, Details)", "header"),
    L(6, 1, "F5", "Result (Pass / Minor NC / Major NC)", "header"),
  ];
  AUDIT_ROWS.forEach((item, index) => {
    const row = index + 6;
    rows[row] = [L(1, 1, `A${row}`, item[0], undefined, "left"), L(2, 1, `B${row}`, item[1]), L(3, 1, `C${row}`, item[2], undefined, "left"), L(4, 1, `D${row}`, item[3], undefined, "left"), A(5, 1, `E${row}`), S(6, 1, `F${row}`, AUDIT_RESULTS)];
  });
  return { columns: 6, widths: ["14%", "10%", "24%", "16%", "22%", "14%"], rows };
}

export function ncrLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 4, "A1", "NON-CONFORMANCE REPORT (NCR)", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID: FRM-NCR-001"), L(2, 1, "B2", "Rev: C"), L(3, 2, "C2", "Location: ISO Compliance Documents / Blank Form Templates", undefined, "left")];
  rows[3] = [L(1, 1, "A3", "Approved By:"), L(2, 1, "B3", "Maxwell Tollefson/ Ron Wertz", undefined, "left"), L(3, 1, "C3", "Date:"), L(4, 1, "D3", "2026-03-18")];
  rows[4] = [];
  rows[5] = [L(1, 4, "A5", "SECTION 1: IDENTIFICATION (Incoming/Outgoing Inspection)", "section")];
  rows[6] = [L(1, 1, "A6", "Report Date:"), D(2, 1, "B6"), L(3, 1, "C6", "Inspector:"), I(4, 1, "D6", "Your Name")];
  rows[7] = [L(1, 1, "A7", "Supplier Name:"), I(2, 1, "B7", "Factory Name"), L(3, 1, "C7", "Supplier Batch/Lot:"), I(4, 1, "D7", "Their Lot #")];
  rows[8] = [L(1, 1, "A8", "Part Number:"), I(2, 1, "B8", "P/N"), L(3, 1, "C8", "Qty Received:"), N(4, 1, "D8", "Qty")];
  rows[9] = [L(1, 1, "A9", "Qty Defective:"), N(2, 1, "B9", "Qty Bad"), L(3, 1, "C9", "PO Number:"), I(4, 1, "D9", "DMA PO #")];
  rows[10] = [];
  rows[11] = [L(1, 4, "A11", "SECTION 2: THE DEFECT", "section")];
  rows[12] = [L(1, 1, "A12", "Requirement (Drawing/Spec):"), A(2, 3, "B12", "e.g. Paint thickness 50 microns")];
  rows[13] = [L(1, 1, "A13", "Actual Condition (Observed):"), A(2, 3, "B13", "e.g. Paint thickness 30 microns")];
  rows[14] = [L(1, 1, "A14", "Photo Attached?"), S(2, 3, "B14", YES_NO)];
  rows[15] = [];
  rows[16] = [L(1, 4, "A16", "SECTION 3: RISK ASSESSMENT (Engineering Review)", "section")];
  rows[17] = [L(1, 1, "A17", "Does this affect fitment or function?"), S(2, 3, "B17", YES_NO)];
  rows[18] = [L(1, 1, "A18", "Can we use this safely?"), S(2, 3, "B18", YES_NO)];
  rows[19] = [L(1, 1, "A19", "Justification for Acceptance (if keeping):"), A(2, 3, "B19", "Enter technical reason")];
  rows[20] = [];
  rows[21] = [L(1, 4, "A21", "SECTION 4: DISPOSITION (Your Decision)", "section")];
  rows[22] = [L(1, 1, "A22", "Select Action:"), C(2, 1, "B22", "USE AS-IS (Concession)"), C(3, 1, "C22", "REWORK (In-House)"), C(4, 1, "D22", "RETURN TO VENDOR")];
  rows[23] = [L(1, 1, "A22b", ""), C(2, 1, "E22", "USE AS-IS (Conditional)")];
  rows[24] = [L(1, 1, "A23", "Chargeback Cost?"), S(2, 1, "B23", YES_NO), L(3, 1, "C23", "Cost Amount:"), N(4, 1, "D23", "0.00")];
  rows[25] = [];
  rows[26] = [L(1, 4, "A25", "SECTION 5: TIME", "section")];
  rows[27] = [L(1, 1, "A26", "Time Spent Investigating/Resolving (hours)"), N(2, 3, "B26", "Time in Hours")];
  rows[28] = [];
  rows[29] = [L(1, 4, "A28", "SECTION 6: AUTHORIZATION", "section")];
  rows[30] = [L(1, 1, "A29", "Engineering Manager Approval:"), I(2, 1, "B29", "Sign Here"), L(3, 1, "C29", "Date:"), D(4, 1, "D29")];
  rows[31] = [L(1, 1, "A30", "Quality Manger Approval:"), L(2, 1, "B30", "Ron Wertz"), L(3, 1, "C30", "Date:"), L(4, 1, "D30", "2026-04-30")];
  rows[32] = [];
  rows[33] = [L(1, 4, "A32", "SECTION 7: SUPPLIER FEEDBACK", "section")];
  rows[34] = [L(1, 1, "A33", "Was a SCAR (Supplier Corrective Action) issued?"), S(2, 1, "B33", YES_NO), L(3, 1, "C33", "SCAR Number:"), I(4, 1, "D33", "If applicable")];
  return { columns: 4, widths: ["32%", "23%", "23%", "22%"], rows };
}

export function quarantineLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 6, "A1", "QUARANTINE NOTICE", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID:"), L(2, 1, "B2", "FRM-NCR-002"), L(3, 1, "C2", "Rev:"), L(4, 1, "D2", "A"), L(5, 1, "E2", "Title:"), L(6, 1, "F2", "Quarantine Notice")];
  rows[3] = [L(1, 1, "A3", "Date:"), D(2, 3, "B3"), L(5, 1, "E3", "Approved By:"), I(6, 1, "F3")];
  rows[4] = [];
  rows[5] = [L(1, 6, "A5", "1.0 ISSUE IDENTIFICATION", "section")];
  rows[6] = [L(1, 1, "A6", "Part Number(s):"), I(2, 5, "B6")];
  rows[7] = [L(1, 1, "A7", "Lot / Batch / PO Number:"), I(2, 5, "B7")];
  rows[8] = [L(1, 1, "A8", "Drawing / Spec Number & Rev:"), I(2, 5, "B8")];
  rows[9] = [];
  rows[10] = [L(1, 6, "A10", "2.0 NON-CONFORMANCE DETAILS", "section")];
  rows[11] = [L(1, 1, "A11", "Description of Issue:"), A(2, 5, "B11")];
  rows[12] = [L(1, 1, "A12", "Expected vs. Actual Result:"), A(2, 5, "B12")];
  rows[13] = [L(1, 1, "A13", "Has Supplier Been Notified? (Y/N):"), S(2, 5, "B13", YN)];
  rows[14] = [];
  rows[15] = [L(1, 6, "A15", "3.0 CONTAINMENT AND INVENTORY", "section")];
  rows[16] = [L(1, 1, "A16", "Location", "header"), L(2, 1, "B16", "Qty", "header")];
  for (let row = 17; row <= 21; row += 1) rows[row] = [I(1, 1, `A${row}`), N(2, 1, `B${row}`)];
  rows[22] = [L(1, 1, "A22", "Total Quarantined:"), K(2, 1, "B22")];
  rows[23] = [];
  rows[24] = [L(1, 6, "A24", "4.0 EVALUATION & ROOT CAUSE ANALYSIS", "section")];
  rows[25] = [L(1, 1, "A25", "Suspected Root Cause:"), A(2, 5, "B25")];
  rows[26] = [L(1, 1, "A26", "Does this impact previous produced parts? (Y/N):"), S(2, 5, "B26", YN)];
  rows[27] = [L(1, 1, "A27", "Is Customer Notification Required? (Y/N):"), S(2, 5, "B27", YN)];
  rows[28] = [];
  rows[29] = [L(1, 6, "A29", "5.0 DISPOSITION AND ACTIONS", "section")];
  rows[30] = [L(1, 1, "A30", "Suggested Disposition Decision (Check One):"), C(2, 3, "B30", "Scrap"), C(5, 1, "E30", "Rework"), C(6, 1, "F30", "Return to Vendor")];
  rows[31] = [L(1, 1, "A31", "Action / Rework Instructions:"), A(2, 5, "B31")];
  rows[32] = [];
  rows[33] = [L(1, 6, "A33", "6.0 APPROVALS AND CLOSURE", "section")];
  rows[34] = [L(1, 1, "A34", "Suggested Disposition Authorized By:"), I(2, 3, "B34"), L(5, 1, "E34", "Date:"), D(6, 1, "F34")];
  return { columns: 6, widths: ["28%", "14%", "12%", "12%", "17%", "17%"], rows };
}

export function concessionLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 4, "A1", "CONCESSION / DEVIATION REQUEST", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID: FRM-NCR-003"), L(2, 1, "B2", "Rev: A"), L(3, 2, "C2", "Location: ISO Compliance Documents / Blank Form Templates", undefined, "left")];
  rows[3] = [L(1, 1, "A3", "Approved By:"), L(2, 1, "B3", "Maxwell Tollefson/ Ron Wertz", undefined, "left"), L(3, 1, "C3", "Date:"), I(4, 1, "D3", "Date")];
  rows[4] = [];
  rows[5] = [L(1, 4, "A5", "SECTION 1: IDENTIFICATION (Outbound to Customer)", "section")];
  rows[6] = [L(1, 1, "A6", "Report Date:"), D(2, 1, "B6"), L(3, 1, "C6", "DMA Quality/Eng Rep:"), I(4, 1, "D6", "Your Name")];
  rows[7] = [L(1, 1, "A7", "Customer Name:"), I(2, 1, "B7", "Customer Name"), L(3, 1, "C7", "DMA Batch/Lot:"), I(4, 1, "D7", "DMA Internal Lot #")];
  rows[8] = [L(1, 1, "A8", "Part Number:"), I(2, 1, "B8", "P/N"), L(3, 1, "C8", "Qty Affected:"), N(4, 1, "D8", "Qty")];
  rows[9] = [L(1, 1, "A9", "Customer PO Number:"), I(2, 1, "B9", "Customer PO #"), L(3, 1, "C9", "DMA Sales Order:"), I(4, 1, "D9", "DMA SO #")];
  rows[10] = [];
  rows[11] = [L(1, 4, "A11", "SECTION 2: DESCRIPTION OF NON-CONFORMANCE", "section")];
  rows[12] = [L(1, 1, "A12", "Requirement (Drawing/Spec):"), A(2, 3, "B12", "e.g. Paint thickness 50 microns")];
  rows[13] = [L(1, 1, "A13", "Actual Condition (Observed):"), A(2, 3, "B13", "e.g. Paint thickness 30 microns")];
  rows[14] = [L(1, 1, "A14", "Photo Attached?"), S(2, 3, "B14", YES_NO)];
  rows[15] = [];
  rows[16] = [L(1, 4, "A16", "SECTION 3: DMA RISK ASSESSMENT & PROPOSED DISPOSITION", "section")];
  rows[17] = [L(1, 1, "A17", "Affects Fitment or Function?"), S(2, 3, "B17", YES_NO)];
  rows[18] = [L(1, 1, "A18", "Safe for Application?"), S(2, 3, "B18", YES_NO)];
  rows[19] = [L(1, 1, "A19", "Proposed Action:"), C(2, 1, "B19", "USE AS-IS (Concession Request)"), C(3, 1, "C19", "REWORK"), C(4, 1, "D19", "REPLACE")];
  rows[20] = [L(1, 1, "A20", "Justification for Proposal:"), A(2, 3, "B20", "Enter technical reason")];
  rows[21] = [];
  rows[22] = [L(1, 4, "A22", "SECTION 4: DMA INTERNAL CORRECTIVE ACTION", "section")];
  rows[23] = [L(1, 1, "A23", "Corrective Action Initiated?"), S(2, 1, "B23", YES_NO), L(3, 1, "C23", "Internal DMA CAR Number:"), I(4, 1, "D23", "Insert Tracking Number")];
  rows[24] = [];
  rows[25] = [L(1, 4, "A25", "SECTION 5: CUSTOMER AUTHORIZATION (To be completed by Customer)", "section")];
  rows[26] = [L(1, 1, "A26", "Customer Decision:"), C(2, 1, "B26", "APPROVED (Accept DMA proposal)"), C(3, 2, "C26", "REJECTED")];
  rows[27] = [L(1, 1, "A27", "Customer Approval:"), I(2, 1, "B27", "Sign Here"), L(3, 1, "C27", "Date:"), D(4, 1, "D27")];
  return { columns: 4, widths: ["32%", "26%", "22%", "20%"], rows };
}

function trainingLines(start: number, count: number, kinds: Array<(row: number, col: number) => FormCell>): FormCell[][] {
  const out: FormCell[][] = [];
  for (let offset = 0; offset < count; offset += 1) {
    const row = start + offset;
    out[row] = kinds.map((make, index) => make(row, index + 1));
  }
  return out;
}

export function trainingLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 7, "A1", "COMPETENCY AND TRAINING RECORD", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID: FRM-TRN-001"), L(2, 1, "B2", "Rev: A"), L(3, 2, "C2", "Location: ISO Compliance Documents / Blank Form Templates", undefined, "left"), L(5, 1, "E2", "Authorized By:"), L(6, 2, "F2", "Maxwell Tollefson", undefined, "left")];
  rows[3] = [];
  rows[4] = [L(1, 1, "A4", "Employee Name:"), I(2, 2, "B4", "Name"), L(4, 1, "D4", "Job Title:"), I(5, 3, "E4", "Job Title")];
  rows[5] = [L(1, 1, "A5", "Start Date:"), D(2, 2, "B5"), L(4, 1, "D5", "Manager:"), I(5, 3, "E5", "Engineering/Quality Manager")];
  rows[6] = [];
  rows[7] = [L(1, 7, "A7", "SECTION 1: DOCUMENT FAMILIARIZATION (Read & Understood)", "section")];
  rows[8] = [L(1, 7, "A8", "I certify that I have read and understood the following procedures:", "note", "left")];
  rows[9] = [L(1, 1, "A9", "Date", "header"), L(2, 1, "B9", "Document ID", "header"), L(3, 1, "C9", "Document Title", "header"), L(4, 1, "D9", "Rev", "header"), L(5, 1, "E9", "Employee Signature", "header"), L(6, 2, "F9", "Manager Initials", "header")];
  const familiar = trainingLines(10, 4, [
    (row) => D(1, 1, `A${row}`),
    (row) => I(2, 1, `B${row}`),
    (row) => I(3, 1, `C${row}`),
    (row) => I(4, 1, `D${row}`),
    (row) => I(5, 1, `E${row}`),
    (row) => I(6, 2, `F${row}`),
  ]);
  for (let row = 10; row <= 13; row += 1) rows[row] = familiar[row]!;
  rows[14] = [];
  rows[15] = [L(1, 7, "A15", "SECTION 2: ON-THE-JOB TRAINING (Demonstrated Competence)", "section")];
  rows[16] = [L(1, 7, "A16", "I certify that the employee has demonstrated competence in the following tasks:", "note", "left")];
  rows[17] = [
    L(1, 1, "A17", "Date", "header"),
    L(2, 1, "B17", "SOP / Method", "header"),
    L(3, 1, "C17", "Method Name / Task", "header"),
    L(4, 1, "D17", "Training Type", "header"),
    L(5, 1, "E17", "Trainer Signature", "header"),
    L(6, 1, "F17", "Employee Signature", "header"),
    L(7, 1, "G17", "Competency Level (1-3)", "header"),
  ];
  for (let row = 18; row <= 21; row += 1) {
    rows[row] = [D(1, 1, `A${row}`), I(2, 1, `B${row}`), I(3, 1, `C${row}`), I(4, 1, `D${row}`), I(5, 1, `E${row}`), I(6, 1, `F${row}`), S(7, 1, `G${row}`, COMPETENCY)];
  }
  rows[22] = [L(1, 7, "A22", "Competency Levels: 1=Observation Only (Cannot perform alone), 2=Supervised (Needs help), 3=Qualified (Can perform alone)", "note", "left")];
  return { columns: 7, widths: ["12%", "14%", "22%", "12%", "14%", "14%", "12%"], rows };
}

export const EXCLUSIVE_CHECKS: Record<string, string[][]> = {
  ncr_report: [["B22", "C22", "D22", "E22"]],
  quarantine_notice: [["B30", "E30", "F30"]],
  concession: [
    ["B19", "C19", "D19"],
    ["B26", "C26"],
  ],
};
