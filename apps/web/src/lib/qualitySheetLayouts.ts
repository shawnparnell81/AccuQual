import type { FormCell, FormLayout } from "./isoFormLayouts";

const L = (col: number, span: number, addr: string, text: string, role?: FormCell["role"], align?: FormCell["align"], paint?: FormCell["paint"]): FormCell => ({
  col,
  span,
  addr,
  kind: "label",
  text,
  role,
  align,
  paint,
});
const I = (col: number, span: number, addr: string, placeholder?: string): FormCell => ({ col, span, addr, kind: "input", placeholder });
const D = (col: number, span: number, addr: string): FormCell => ({ col, span, addr, kind: "date" });
const N = (col: number, span: number, addr: string, placeholder?: string): FormCell => ({ col, span, addr, kind: "number", placeholder });
const C = (col: number, span: number, addr: string, text: string): FormCell => ({ col, span, addr, kind: "check", text, align: "left" });
const A = (col: number, span: number, addr: string, placeholder?: string): FormCell => ({ col, span, addr, kind: "area", placeholder });
const K = (col: number, span: number, addr: string): FormCell => ({ col, span, addr, kind: "calc" });

export const TURTLE_CONTEXTS = [
  "Context",
  "Managing Process",
  "New Launches",
  "Purchasing",
  "SQA",
  "Logistic",
  "Process Quality",
  "Production",
  "Maintenance",
  "HR",
  "Continuous Improvement",
  "QMS",
  "EHS",
  "IT",
  "Finance",
] as const;

/** Checks that cannot be on together. Reason-for-submission boxes stay independent. */
export const QUALITY_EXCLUSIVE_CHECKS: Record<string, string[][]> = {
  psw: [
    ["B7", "C7"],
    ["B20", "C20", "D20"],
    ["B22", "C22", "D22"],
    ["A31", "A32", "A33", "A34", "A35"],
    ["C40", "D40"],
    ["C47", "D47"],
    ["B53", "C53", "D53"],
  ],
};

export function pswLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 4, "A1", "PART SUBMISSION WARRANT", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID: FRM-PSW-001"), L(2, 1, "B2", "Rev: A"), L(3, 2, "C2", "Location: ISO Compliance Documents / Blank Form Templates", undefined, "left")];
  rows[3] = [L(1, 1, "A3", "Part Name"), I(2, 1, "B3"), L(3, 1, "C3", "Customer Part Number"), I(4, 1, "D3")];
  rows[4] = [L(1, 1, "A4", "Shown on Drawing No."), I(2, 1, "B4"), L(3, 1, "C4", "Organization Part Number"), I(4, 1, "D4")];
  rows[5] = [L(1, 1, "A5", "Engineering Change Level"), I(2, 1, "B5"), L(3, 1, "C5", "Dated"), D(4, 1, "D5")];
  rows[6] = [L(1, 1, "A6", "Additional Engineering Changes"), I(2, 1, "B6"), L(3, 1, "C6", "Dated"), D(4, 1, "D6")];
  rows[7] = [L(1, 1, "A7", "Safety and/or Government Regulation", undefined, "left"), C(2, 1, "B7", "Yes"), C(3, 1, "C7", "No")];
  rows[8] = [L(1, 1, "A8", "Purchase Order No."), I(2, 1, "B8"), L(3, 1, "C8", "Weight (kg)"), N(4, 1, "D8")];
  rows[9] = [L(1, 1, "A9", "Checking Aid No."), I(2, 1, "B9"), L(3, 1, "C9", "Checking Aid Engineering Change Level"), I(4, 1, "D9")];
  rows[10] = [L(1, 1, "A10", "Checking Aid Dated"), D(2, 1, "B10")];
  rows[11] = [L(1, 4, "A11", "SUPPLIER MANUFACTURING INFORMATION", "section")];
  rows[12] = [L(1, 1, "A12", "Supplier Name & Supplier/Vendor Code", undefined, "left"), I(2, 3, "B12")];
  rows[13] = [L(1, 1, "A13", "Street Address"), I(2, 3, "B13")];
  rows[14] = [L(1, 1, "A14", "City"), I(2, 1, "B14"), L(3, 1, "C14", "Region"), I(4, 1, "D14")];
  rows[15] = [L(1, 1, "A15", "Postal Code"), I(2, 1, "B15"), L(3, 1, "C15", "Country"), I(4, 1, "D15")];
  rows[16] = [L(1, 4, "A16", "CUSTOMER SUBMITTAL INFORMATION", "section")];
  rows[17] = [L(1, 1, "A17", "Contact Name"), I(2, 1, "B17"), L(3, 1, "C17", "Customer Name/Division"), I(4, 1, "D17")];
  rows[18] = [L(1, 1, "A18", "Application"), I(2, 3, "B18")];
  rows[19] = [L(1, 4, "A19", "MATERIALS REPORTING", "section")];
  rows[20] = [L(1, 1, "A20", "Substances of Concern information reported?", undefined, "left"), C(2, 1, "B20", "Yes"), C(3, 1, "C20", "No"), C(4, 1, "D20", "n/a")];
  rows[21] = [L(1, 1, "A21", "Submitted by IMDS or other customer format", undefined, "left"), I(2, 3, "B21")];
  rows[22] = [L(1, 1, "A22", "Polymeric parts identified with ISO marking codes?", undefined, "left"), C(2, 1, "B22", "Yes"), C(3, 1, "C22", "No"), C(4, 1, "D22", "n/a")];
  rows[23] = [L(1, 4, "A23", "REASON FOR SUBMISSION (check at least one)", "section")];
  rows[24] = [C(1, 2, "A24", "Initial Submission"), C(3, 2, "C24", "Change to Optional Construction or Material")];
  rows[25] = [C(1, 2, "A25", "Engineering Change(s)"), C(3, 2, "C25", "Sub-Supplier or Material Source Change")];
  rows[26] = [C(1, 2, "A26", "Tooling: Transfer, Replacement, Refurbishment, or additional"), C(3, 2, "C26", "Change in Part Processing")];
  rows[27] = [C(1, 2, "A27", "Correction of Discrepancy"), C(3, 2, "C27", "Parts Produced at Additional Location")];
  rows[28] = [C(1, 2, "A28", "Tooling Inactive > 1 year"), C(3, 2, "C28", "Other — please specify")];
  rows[29] = [L(1, 1, "A29", "Other (specify)"), I(2, 3, "B29")];
  rows[30] = [L(1, 4, "A30", "REQUESTED SUBMISSION LEVEL (check one)", "section")];
  rows[31] = [C(1, 4, "A31", "Level 1 — Warrant only (and for designated appearance items, an Appearance Approval Report) submitted to the customer.")];
  rows[32] = [C(1, 4, "A32", "Level 2 — Warrant with product samples and limited supporting data submitted to the customer.")];
  rows[33] = [C(1, 4, "A33", "Level 3 — Warrant with product samples and complete supporting data submitted to the customer.")];
  rows[34] = [C(1, 4, "A34", "Level 4 — Warrant and other requirements as defined by the customer.")];
  rows[35] = [C(1, 4, "A35", "Level 5 — Warrant with product samples and complete supporting data reviewed at the supplier's manufacturing location.")];
  rows[36] = [L(1, 4, "A36", "SUBMISSION RESULTS", "section")];
  rows[37] = [L(1, 4, "A37", "The results for:", "note", "left")];
  rows[38] = [C(1, 2, "A38", "Dimensional measurements"), C(3, 2, "C38", "Material and functional tests")];
  rows[39] = [C(1, 2, "A39", "Appearance criteria"), C(3, 2, "C39", "Statistical process package")];
  rows[40] = [L(1, 2, "A40", "These results meet all drawing and specification requirements. If No, explain below.", undefined, "left"), C(3, 1, "C40", "Yes"), C(4, 1, "D40", "No")];
  rows[41] = [L(1, 1, "A41", "Mold / Cavity / Production Process"), I(2, 3, "B41")];
  rows[42] = [L(1, 4, "A42", "DECLARATION", "section")];
  rows[43] = [L(1, 4, "A43", "I hereby affirm that the samples represented by this warrant are representative of our parts, which were made by a process that meets all Production Part Approval Process Manual 4th Edition requirements. I further affirm that these samples were produced at the production rate below. I also certify that documented evidence of such compliance is on file and available for review.", "note", "left")];
  rows[44] = [L(1, 1, "A44", "Production rate"), N(2, 1, "B44", "Quantity"), L(3, 1, "C44", "per hours"), N(4, 1, "D44", "Hours")];
  rows[45] = [L(1, 1, "A45", "Explanation / Comments"), A(2, 3, "B46")];
  rows[46] = [L(1, 2, "A47", "Is each customer tool properly tagged and numbered?", undefined, "left"), C(3, 1, "C47", "Yes"), C(4, 1, "D47", "No")];
  rows[47] = [L(1, 1, "A48", "Organization Authorized Signature"), I(2, 1, "B48"), L(3, 1, "C48", "Date"), D(4, 1, "D48")];
  rows[48] = [L(1, 1, "A49", "Print Name"), I(2, 1, "B49"), L(3, 1, "C49", "Phone No."), I(4, 1, "D49")];
  rows[49] = [L(1, 1, "A50", "Title"), I(2, 1, "B50"), L(3, 1, "C50", "Fax No."), I(4, 1, "D50")];
  rows[50] = [L(1, 1, "A51", "Email"), I(2, 3, "B51")];
  rows[51] = [L(1, 4, "A52", "FOR CUSTOMER USE ONLY (IF APPLICABLE)", "section")];
  rows[52] = [L(1, 1, "A53", "Part Warrant Disposition"), C(2, 1, "B53", "Approved"), C(3, 1, "C53", "Rejected"), C(4, 1, "D53", "Other")];
  rows[53] = [L(1, 1, "A54", "Customer Signature"), I(2, 1, "B54"), L(3, 1, "C54", "Date"), D(4, 1, "D54")];
  rows[54] = [L(1, 1, "A55", "Print Name"), I(2, 1, "B55"), L(3, 1, "C55", "Customer Tracking Number"), I(4, 1, "D55")];
  return { columns: 4, widths: ["30%", "24%", "26%", "20%"], rows };
}

export function turtleLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 4, "A1", "TURTLE DIAGRAM", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID: FRM-PRC-001"), L(2, 1, "B2", "Rev: A"), L(3, 2, "C2", "Location: ISO Compliance Documents / Blank Form Templates", undefined, "left")];
  rows[3] = [L(1, 2, "A3", "MATERIAL RESOURCES", "header"), L(3, 2, "C3", "HR RESOURCES", "header")];
  rows[4] = [A(1, 2, "A4", "1.\n2."), A(3, 2, "C4", "1.\n2.")];
  rows[5] = [L(1, 1, "A5", "Process"), I(2, 1, "B5", "Process name"), L(3, 1, "C5", "Process Owner"), I(4, 1, "D5")];
  rows[6] = [L(1, 1, "A6", "Process description", undefined, "left"), A(2, 3, "B6", "What this process does")];
  rows[7] = [L(1, 1, "A7", "Process / context", "header"), L(2, 1, "B7", "Internal / external input", "header"), L(3, 1, "C7", "Process / context", "header"), L(4, 1, "D7", "Internal / external output", "header")];
  TURTLE_CONTEXTS.forEach((name, index) => {
    const row = 8 + index;
    rows[row] = [L(1, 1, `A${row}`, name, undefined, "left"), A(2, 1, `B${row}`), L(3, 1, `C${row}`, name, undefined, "left"), A(4, 1, `D${row}`)];
  });
  const foot = 8 + TURTLE_CONTEXTS.length;
  rows[foot] = [L(1, 1, `A${foot}`, "OBJECTIVE AND KPIs", "header"), L(2, 1, `B${foot}`, "REFERENCES", "header"), L(3, 2, `C${foot}`, "DOCUMENTS", "header")];
  rows[foot + 1] = [
    A(1, 1, `A${foot + 1}`, "1.\n2.\n\nKPIs:\n1.\n2.\n3."),
    A(2, 1, `B${foot + 1}`, "IATF 16949\nISO 14001\nISO 45001"),
    A(3, 2, `C${foot + 1}`, "Documents\n1.\n\nRelated procedures\n1.\n\nPlant procedures\n1."),
  ];
  return { columns: 4, widths: ["18%", "32%", "18%", "32%"], rows };
}

export function qualityAlertLayout(): FormLayout {
  const rows: FormCell[][] = [];
  rows[1] = [L(1, 4, "A1", "QUALITY ALERT", "title")];
  rows[2] = [L(1, 1, "A2", "Doc ID: FRM-QA-001"), L(2, 1, "B2", "Rev: A"), L(3, 1, "C2", "Quality Alert number"), I(4, 1, "D2")];
  rows[3] = [L(1, 1, "A3", "Issue date"), D(2, 1, "B3"), L(3, 1, "C3", "Closing date (30 days from issue date)", undefined, "left"), K(4, 1, "D3")];
  rows[4] = [L(1, 1, "A4", "Review date"), D(2, 1, "B4"), L(3, 1, "C4", "SC / CC Symbol"), I(4, 1, "D4")];
  rows[5] = [L(1, 4, "A5", "CONCERN", "section")];
  rows[6] = [L(1, 1, "A6", "Concern to"), I(2, 3, "B6")];
  rows[7] = [C(1, 2, "A7", "Internal issue"), C(3, 2, "C7", "Problem reported by client")];
  rows[8] = [L(1, 1, "A8", "Extended to"), I(2, 3, "B8")];
  rows[9] = [L(1, 1, "A9", "Production facility", undefined, "left"), A(2, 1, "B9"), L(3, 1, "C9", "Client / Contact", undefined, "left"), A(4, 1, "D9")];
  rows[10] = [L(1, 1, "A10", "Part number / model / name", undefined, "left"), I(2, 1, "B10"), L(3, 1, "C10", "Position"), I(4, 1, "D10")];
  rows[11] = [L(1, 1, "A11", "Person who initiated the Quality Alert", undefined, "left"), I(2, 3, "B11")];
  rows[12] = [L(1, 4, "A12", "APPROVALS REQUIRED", "section")];
  rows[13] = [L(1, 1, "A13", "Quality Manager / Authorized Approver", undefined, "left"), I(2, 3, "B13", "Signature")];
  rows[14] = [L(1, 1, "A14", "Other personnel", undefined, "left"), I(2, 3, "B14")];
  rows[15] = [L(1, 1, "A15", "Quality Manager approval for a duration extension", undefined, "left"), I(2, 3, "B15")];
  rows[16] = [L(1, 4, "A16", "PROBLEM DESCRIPTION", "section")];
  rows[17] = [A(1, 4, "A17", "Indicate what the problem is. 5W2H can be used.")];
  rows[18] = [L(1, 4, "A18", "PHOTO OR RELATED DRAWING", "section")];
  rows[19] = [L(1, 2, "A19", "NOK", "header", "center", "fill-red"), L(3, 2, "C19", "OK", "header", "center", "fill-green")];
  rows[20] = [A(1, 2, "A20", "Not acceptable condition"), A(3, 2, "C20", "Acceptable condition")];
  rows[21] = [L(1, 4, "A21", "IMMEDIATE ACTIONS (ICA)", "section")];
  rows[22] = [L(1, 4, "A22", "Where will the activities take place? (off-line zone, station number, and so on)", "note", "left")];
  rows[23] = [A(1, 4, "A23")];
  rows[24] = [L(1, 4, "A24", "What parts are affected? Include part numbers, lot, date of manufacture, and stock quantities.", "note", "left")];
  rows[25] = [A(1, 4, "A25")];
  rows[26] = [L(1, 4, "A26", "What actions must be implemented? Control method, criteria, visual aids, equipment, tools, and gauges.", "note", "left")];
  rows[27] = [A(1, 4, "A27")];
  rows[28] = [L(1, 4, "A28", "How will certified parts be marked after verification?", "note", "left")];
  rows[29] = [A(1, 4, "A29")];
  rows[30] = [L(1, 4, "A30", "What will the marking of the package containing certified parts look like?", "note", "left")];
  rows[31] = [A(1, 4, "A31")];
  rows[32] = [L(1, 4, "A32", "Decision for parts, components, or raw materials found non-compliant. Include quantities to scrap, repair, or return.", "note", "left")];
  rows[33] = [A(1, 4, "A33")];
  rows[34] = [L(1, 4, "A34", "Closing activities and product or process changes planned to close the alert. Include exit criteria and document updates.", "note", "left")];
  rows[35] = [A(1, 4, "A35")];
  rows[36] = [L(1, 4, "A36", "If the signaled problem does not occur during the 30-day alert, the alert is closed. If it recurs, the Quality Manager may extend it.", "note", "left")];
  return { columns: 4, widths: ["28%", "22%", "28%", "22%"], rows };
}
