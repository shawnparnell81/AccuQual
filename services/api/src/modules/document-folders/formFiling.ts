/**
 * One place to change how blank templates are filed.
 * The owner will replace the name pattern later.
 * Tokens: {formId} {recordNumber} {date}
 *
 * Each template has one home under Document Folders > ISO Compliance,
 * at `isoPath` (Quality > Validation, Problem Solving, and so on).
 * A filled record stays in `subjectRoute`. The Forms Library lists these
 * same rows.
 */
export const FILE_NAME_PATTERN = "{formId}_{recordNumber}_{date}";

export interface FormTemplateSeed {
  formKey: string;
  formId: string;
  title: string;
  /** Topic folders under ISO Compliance. ["Quality", "Validation"] is Quality > Validation. */
  isoPath: string[];
  /** Where a filled record is filed and opened. */
  subjectRoute: string;
}

const qms = (formType: string, title: string, department: string, topic: string): FormTemplateSeed => ({
  formKey: formType,
  formId: formType.toUpperCase().replace(/_/g, "-"),
  title,
  isoPath: [department, topic],
  subjectRoute: `/qms-forms/${formType}`,
});

export const FORM_TEMPLATES: FormTemplateSeed[] = [
  { formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA Validation Report", isoPath: ["Quality", "Validation"], subjectRoute: "/folders/validation-reports" },
  { formKey: "frm-val-007", formId: "FRM-VAL-007", title: "Fuel Pump Validation", isoPath: ["Quality", "Validation"], subjectRoute: "/folders/validation-reports" },
  { formKey: "8d", formId: "8D", title: "8D Problem Solving", isoPath: ["Problem Solving"], subjectRoute: "/8d" },
  { formKey: "ncr", formId: "NCR", title: "Nonconformance Report", isoPath: ["Problem Solving"], subjectRoute: "/ncr" },
  { formKey: "capa", formId: "CAPA", title: "Corrective Action Request", isoPath: ["Problem Solving"], subjectRoute: "/capa" },
  { formKey: "supplier-ncr", formId: "SUPPLIER-NCR", title: "Supplier NCR", isoPath: ["Problem Solving"], subjectRoute: "/ncr" },
  { formKey: "deviation-waiver", formId: "DEVIATION-WAIVER", title: "Deviation / Waiver Request", isoPath: ["Problem Solving"], subjectRoute: "/qms-forms/deviation_waiver_request" },
  qms("document_revision_record", "Document Revision Record", "Quality", "Document Control"),
  qms("master_document_register", "Master Document Register", "Quality", "Document Control"),
  qms("record_retention_log", "Record Retention Log", "Quality", "Document Control"),
  qms("quality_record_disposition", "Quality Record Disposition Form", "Quality", "Document Control"),
  qms("quality_objectives_action_plan", "Quality Objectives & Action Plan", "Quality", "Quality Manual & Policies"),
  qms("management_review_record", "Management Review Record", "Quality", "Quality Manual & Policies"),
  qms("preventive_risk_action", "Preventive / Risk Reduction Action", "Quality", "Corrective & Preventive Actions"),
  qms("supplier_qualification_evaluation", "Supplier Qualification & Evaluation", "Quality", "Supplier Quality"),
  qms("first_article_inspection", "First Article Inspection Report", "Quality", "Production & Inspection"),
  qms("in_process_inspection", "In-Process Inspection Record", "Quality", "Production & Inspection"),
  qms("final_inspection_release", "Final Inspection & Release Record", "Quality", "Production & Inspection"),
  qms("quality_kpi_monitoring", "Quality KPI Monitoring Form", "Quality", "Production & Inspection"),
  qms("training_matrix", "Training Matrix", "Quality", "Training & Competency"),
  qms("change_control_record", "Change Control Record", "Quality", "Records"),
  qms("audit_finding_action_log", "Audit Finding & Action Log", "Quality", "Audits"),
  qms("incoming_inspection_record", "Incoming Inspection Record", "Shipping & Receiving", "Incoming Inspection"),
  qms("design_history_form", "Design History Form", "Engineering", "Design & Development"),
  { formKey: "dcr", formId: "DCR", title: "Document Change Request", isoPath: ["Quality", "Document Control"], subjectRoute: "/document-change-requests" },
  { formKey: "risk", formId: "RISK", title: "Risk & Opportunity Assessment", isoPath: ["Quality", "Risk Management"], subjectRoute: "/risk" },
  { formKey: "audit-plan", formId: "AUDIT-PLAN", title: "Internal Audit Plan", isoPath: ["Quality", "Audits"], subjectRoute: "/audits" },
  { formKey: "audit-report", formId: "AUDIT-REPORT", title: "Internal Audit Report", isoPath: ["Quality", "Audits"], subjectRoute: "/audits" },
  { formKey: "cal-register", formId: "CAL-REGISTER", title: "Calibration Equipment Register", isoPath: ["Quality", "Calibration"], subjectRoute: "/calibration" },
  { formKey: "cal-record", formId: "CAL-RECORD", title: "Calibration Record", isoPath: ["Quality", "Calibration"], subjectRoute: "/calibration" },
  { formKey: "training-record", formId: "TRAINING-RECORD", title: "Training & Competency Record", isoPath: ["Quality", "Training & Competency"], subjectRoute: "/training" },
  { formKey: "complaint", formId: "COMPLAINT", title: "Customer Complaint Record", isoPath: ["Quality", "Customer Quality"], subjectRoute: "/complaints" },
  { formKey: "ecr", formId: "ECR", title: "Engineering Change Request", isoPath: ["Engineering", "Change Control"], subjectRoute: "/change" },
  { formKey: "eco", formId: "ECO", title: "Engineering Change Order", isoPath: ["Engineering", "Change Control"], subjectRoute: "/change" },
];

export function filedRecordName(formId: string, recordNumber: number | string, date: string, pattern = FILE_NAME_PATTERN): string {
  return pattern.replaceAll("{formId}", formId).replaceAll("{recordNumber}", String(recordNumber)).replaceAll("{date}", date);
}
