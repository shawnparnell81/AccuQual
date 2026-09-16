import type { RmaLogRecord } from "../../api/types";

/**
 * The JSON-schema description of the RMA Log register — the module-
 * specific RBAC build's own literal 17-column field list, no more, no
 * less. Same "schema array drives the renderer, nothing hardcoded in JSX"
 * approach CRAR already established (see crarFormSchema.ts's own comment
 * on why this app's generic form_data engine isn't the right fit for a
 * record with real relational FKs and a real workflow) — applied here at
 * the smaller scale this form actually needs (one section, no checkbox
 * rows, since dispositionAction is the only fixed-choice field).
 */
export type RmaLogFieldType = "text" | "textarea" | "date" | "number" | "select";

export interface RmaLogField {
  name: keyof RmaLogRecord;
  label: string;
  type: RmaLogFieldType;
  options?: { value: string; label: string }[];
  /** Out of 12 — how wide this field is in its row. */
  span: number;
}

const field = (name: keyof RmaLogRecord, label: string, type: RmaLogFieldType = "text", span = 4, options?: { value: string; label: string }[]): RmaLogField => ({
  name,
  label,
  type,
  span,
  options,
});

export const DISPOSITION_OPTIONS = [
  { value: "warranty", label: "Warranty" },
  { value: "scrap", label: "Scrap" },
  { value: "repair", label: "Repair" },
  { value: "replace", label: "Replace" },
  { value: "credit", label: "Credit" },
];

/** Rows of fields, 12-column grid, in the brief's own literal numbered order. */
export const RMA_LOG_FORM_SCHEMA: RmaLogField[][] = [
  [field("rmaNumber", "RMA Number", "text", 4), field("dateIssued", "Date Issued", "date", 4), field("trackingNumber", "Tracking Number", "text", 4)],
  [field("customerName", "Customer Name", "text", 6), field("originalOrderNumber", "Original Order Number", "text", 6)],
  [field("partNumber", "Part Number", "text", 4), field("partDescription", "Part Description", "text", 5), field("quantityReturned", "Quantity Returned", "number", 3)],
  [field("serialNumber", "Serial Number (If Applicable)", "text", 6)],
  [field("customerReasonForReturn", "Customer Reason for Return", "textarea", 12)],
  [field("dateReceived", "Date Received", "date", 4)],
  [field("qualityTeamFindings", "Quality Team Findings", "textarea", 12)],
  [field("dispositionAction", "Disposition Action", "select", 4, DISPOSITION_OPTIONS)],
  [field("correctiveAction", "Corrective Action (RCA, 8D)", "textarea", 12)],
  [field("creditMemo", "Credit Memo (If Applicable)", "text", 6), field("dateClosed", "Date Closed", "date", 4)],
];
