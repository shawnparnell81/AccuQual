import type { CrarClaim } from "../../api/types";

/**
 * The JSON-schema description of the Customer Return Analysis Report —
 * every one of the source PDF's own 54 real fillable fields (see the
 * backend's crar.ts schema comment), same names, same 13 numbered
 * subsections, same grouping into rows, in the same order. CrarFormRenderer
 * .tsx reads this array to lay out the form; nothing about a field's
 * label/type/grouping is hardcoded in JSX — this file is the one place
 * that changes if the form itself ever needs to (with the same zero-
 * deviation care this was built with the first time).
 *
 * Evidence/photo placeholder areas from the source PDF (pages 3-5, "paste a
 * photo here") were never real AcroForm fields there either — they're
 * handled on the detail page via the existing generic AttachmentsPanel,
 * same as every other module's evidence uploads, not part of this schema.
 */
export type CrarFieldType = "text" | "textarea" | "date" | "select";

export interface CrarField {
  kind: "field";
  name: keyof CrarClaim;
  label: string;
  type: CrarFieldType;
  options?: string[];
  /** Out of 12 — how wide this field is in its row (row always sums to 12). */
  span: number;
}

export interface CrarCheckboxRow {
  kind: "checkboxRow";
  items: { name: keyof CrarClaim; label: string }[];
}

export type CrarRow = CrarField[] | CrarCheckboxRow;

export interface CrarSection {
  number: number;
  title: string;
  rows: CrarRow[];
}

const field = (name: keyof CrarClaim, label: string, type: CrarFieldType = "text", span = 4, options?: string[]): CrarField => ({ kind: "field", name, label, type, span, options });

export const CRAR_FORM_SCHEMA: CrarSection[] = [
  {
    number: 1,
    title: "Return / Customer Identification",
    rows: [
      [field("customerName", "Customer Name", "text", 6), field("rmaNumber", "RMA #", "text", 3), field("customerClaim", "Customer Claim #", "text", 3)],
      [field("partNumber", "Part #", "text", 4), field("partDescription", "Part Description", "text", 5), field("qtyReturned", "Qty Returned", "text", 3)],
      [field("reportInitiatedBy", "Report Initiated By", "text", 4), field("reportDate", "Date Report Initiated", "date", 4), field("approvedBy", "Approved By", "text", 4)],
      [field("customerComplaint", "Short Description of Customer Complaint", "textarea", 12)],
    ],
  },
  {
    number: 3,
    title: "Customer Complaint & Initial Assessment",
    rows: [
      [field("complaintDetail", "Customer Complaint / Claimed Failure", "textarea", 12)],
      [field("dateReceived", "Date Product Received", "date", 4), field("receivedBy", "Received By", "text", 4), field("conditionOnReceipt", "Condition on Receipt", "text", 4)],
    ],
  },
  {
    number: 4,
    title: "Initial Assessment",
    rows: [
      { kind: "checkboxRow", items: [{ name: "assessmentDamage", label: "Visible damage" }, { name: "assessmentMissing", label: "Missing components" }, { name: "assessmentContamination", label: "Contamination" }] },
      { kind: "checkboxRow", items: [{ name: "assessmentPackaging", label: "Packaging issue" }, { name: "assessmentMismatch", label: "Part / configuration mismatch" }, { name: "assessmentOther", label: "Other" }] },
      [field("initialAssessmentNotes", "Initial Assessment Notes", "textarea", 12)],
    ],
  },
  {
    number: 5,
    title: "Investigation Plan",
    rows: [
      [field("investigationPlan", "Planned Investigation / Questions to Answer", "textarea", 12)],
      [
        field("investigator", "Investigator / Report Owner", "text", 5),
        field("targetCompletion", "Target Completion Date", "date", 3),
        field("priority", "Priority", "select", 4, ["Low", "Medium", "High", "Critical"]),
      ],
    ],
  },
  {
    number: 6,
    title: "Receiving Documentation / Evidence",
    rows: [[field("evidenceNotes", "Evidence / Document Notes — Identify Source, Date, and Relevance", "textarea", 12)]],
  },
  {
    number: 7,
    title: "Drawings, Specifications & Requirements",
    rows: [
      [field("drawingSpecNo", "Drawing / Specification No.", "text", 4), field("drawingRevision", "Revision", "text", 2), field("applicableRequirement", "Applicable Requirement", "text", 6)],
      [field("acceptanceCriteria", "Technical Requirement / Acceptance Criteria", "textarea", 12)],
    ],
  },
  {
    number: 9,
    title: "Tests Performed & Test Results",
    rows: [
      [field("testResults", "Test / Inspection Method, Equipment, Conditions, and Results", "textarea", 12)],
      [field("testedBy", "Tested By", "text", 4), field("testDate", "Test Date", "date", 4), field("overallTestResult", "Overall Test Result", "select", 4, ["Pass", "Fail", "Inconclusive"])],
    ],
  },
  {
    number: 10,
    title: "Findings & Conclusion",
    rows: [
      [field("findings", "Findings — Objective Evidence and Failure Determination", "textarea", 12)],
      [field("rootCause", "Root Cause / Suspected Cause (if determined)", "textarea", 12)],
      [field("conclusion", "Conclusion — Concise Disposition Rationale and Customer-Facing Conclusion", "textarea", 12)],
    ],
  },
  {
    number: 11,
    title: "Warranty / Customer Return Disposition",
    rows: [
      { kind: "checkboxRow", items: [{ name: "warrantyAccepted", label: "Warranty Accepted" }, { name: "warrantyDenied", label: "Warranty Denied" }] },
      [
        field("acceptedDisposition", "If Accepted — Disposition", "select", 6, ["Repair", "Replace", "Credit / Refund", "Scrap", "Return to Customer"]),
        field("deniedReason", "If Denied — Reason", "select", 6, ["Out of Warranty Period", "Customer Misuse", "No Defect Found", "Unauthorized Modification", "Other"]),
      ],
      [field("dispositionExplanation", "Disposition Explanation / Required Corrective Action / Customer Communication", "textarea", 12)],
      { kind: "checkboxRow", items: [{ name: "correctiveActionRequired", label: "Corrective action / CAPA required" }, { name: "engineeringReviewRequired", label: "Engineering review required" }] },
      [
        field("carNumber", "Related Corrective Action / CAR #", "text", 5),
        field("customerCommunicationDate", "Customer Communication Date", "date", 4),
        field("dispositionDate", "Disposition Date", "date", 3),
      ],
    ],
  },
  {
    number: 12,
    title: "Approval / Final Record",
    rows: [
      [field("finalReviewComments", "Final Review Comments", "textarea", 12)],
      [field("preparedByFinal", "Report Prepared By", "text", 5), field("preparedSignature", "Signature / Initials", "text", 4), field("preparedDate", "Date", "date", 3)],
      [field("approvedByFinal", "Report Approved By", "text", 5), field("approvedSignature", "Signature / Initials", "text", 4), field("approvedDate", "Date", "date", 3)],
    ],
  },
  {
    number: 13,
    title: "Record Retention / Closeout",
    rows: [
      [field("recordLocation", "Quality Record Location / File Reference", "text", 7), field("retentionClass", "Retention / Record Class", "text", 5)],
      { kind: "checkboxRow", items: [{ name: "recordClosed", label: "Investigation complete / record closed" }, { name: "customerNotified", label: "Customer notified" }] },
      [field("additionalNotes", "Additional Notes / Attachments Index", "textarea", 12)],
    ],
  },
];
