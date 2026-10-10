import type { RecordNumberSpec } from "./userRecordNumber.js";

export const NCR_NUMBER: RecordNumberSpec = { table: "ncr", column: "record_number", field: "recordNumber", label: "NCR No." };
export const CAPA_NUMBER: RecordNumberSpec = { table: "capa", column: "record_number", field: "recordNumber", label: "CAPA No." };
export const EIGHT_D_NUMBER: RecordNumberSpec = { table: "eight_d", column: "record_number", field: "recordNumber", label: "8D No." };
export const AUDIT_NUMBER: RecordNumberSpec = { table: "audits", column: "record_number", field: "recordNumber", label: "Audit No." };
export const COMPLAINT_NUMBER: RecordNumberSpec = { table: "complaints", column: "record_number", field: "recordNumber", label: "Complaint No." };
export const CHANGE_NUMBER: RecordNumberSpec = { table: "change_requests", column: "record_number", field: "recordNumber", label: "Change No." };
export const PPAP_NUMBER: RecordNumberSpec = { table: "ppap_packages", column: "record_number", field: "recordNumber", label: "PPAP No." };
export const RISK_NUMBER: RecordNumberSpec = { table: "risk_assessments", column: "record_number", field: "recordNumber", label: "Risk No." };
export const WORK_ORDER_NUMBER: RecordNumberSpec = { table: "work_orders", column: "record_number", field: "recordNumber", label: "Work Order No." };
export const DISCREPANCY_NUMBER: RecordNumberSpec = { table: "discrepancy_investigations", column: "record_number", field: "recordNumber", label: "Record No." };
export const INSPECTION_NUMBER: RecordNumberSpec = { table: "quality_inspection_reports", column: "record_number", field: "recordNumber", label: "Report No." };
export const SCAR_NUMBER: RecordNumberSpec = { table: "scar_forms", column: "scar_number", field: "scarNumber", label: "SCAR No." };
export const QMS_NUMBER: RecordNumberSpec = { table: "qms_forms", column: "form_no", field: "formNo", label: "Form No.", typeColumn: "form_type", typeField: "formType" };
export const DCR_NUMBER: RecordNumberSpec = { table: "document_change_requests", column: "form_no", field: "formNo", label: "DCR No." };
export const ISO_NUMBER: RecordNumberSpec = { table: "iso_quality_forms", column: "record_number", field: "recordNumber", label: "Record No.", typeColumn: "form_type", typeField: "formType" };
export const VALIDATION_NUMBER: RecordNumberSpec = {
  table: "validation_reports",
  column: "record_number",
  field: "recordNumber",
  label: "Report No.",
  jsonType: { column: "data", path: "formType", fallback: "csa" },
};
export const FAI_NUMBER: RecordNumberSpec = { table: "fai_records", column: "number", field: "number", label: "FAI No." };
export const CSA_FAI_NUMBER: RecordNumberSpec = { table: "csa_fai_records", column: "number", field: "number", label: "CSA FAI No." };
export const FUEL_PUMP_FAI_NUMBER: RecordNumberSpec = { table: "fuel_pump_fai_records", column: "fai_number", field: "faiNumber", label: "FAI No." };
export const RMA_NUMBER: RecordNumberSpec = { table: "rma", column: "rma_number", field: "rmaNumber", label: "RMA No." };
export const RMA_LOG_NUMBER: RecordNumberSpec = { table: "rma_log", column: "rma_number", field: "rmaNumber", label: "RMA No." };
export const WARRANTY_NUMBER: RecordNumberSpec = { table: "warranty_claims", column: "claim_number", field: "claimNumber", label: "Claim No." };
export const LABOR_NUMBER: RecordNumberSpec = { table: "labor_claims", column: "claim_number", field: "claimNumber", label: "Claim No." };
export const BUILT_FILL_NUMBER: RecordNumberSpec = { table: "built_form_fills", column: "record_number", field: "recordNumber", label: "Record No.", typeColumn: "form_id", typeField: "formId" };
