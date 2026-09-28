/**
 * One place to change how blank templates are filed.
 * The owner will replace the name pattern later.
 * Tokens: {formId} {recordNumber} {date}
 *
 * Folder names:
 * ISO Compliance Documents / Blank Form Templates
 * Topic folders (Validation, Problem Solving, and so on) sit inside the blank-forms folder.
 * A filled record stays in `subjectRoute`. The Forms Library lists these same rows
 * and starts a new record with `start`.
 */
export const FILE_NAME_PATTERN = "{formId}_{recordNumber}_{date}";

/** Top Documents folder. */
export const ISO_DOCUMENTS_FOLDER = "ISO Compliance Documents";

/** Every blank template lives under this folder. No number prefix. */
export const BLANK_FORMS_FOLDER = "Blank Form Templates";

/** How the Forms Library opens a blank copy of this template. `{id}` is the new record. */
export interface FormStart {
  createPath: string;
  body: Record<string, unknown>;
  openPath: string;
}

export interface FormTemplateSeed {
  formKey: string;
  formId: string;
  title: string;
  /** Topic folder inside BLANK_FORMS_FOLDER. */
  topic: string;
  /** Where a filled record is filed. */
  subjectRoute: string;
  start: FormStart;
}

function blank(createPath: string, openPath: string, body: Record<string, unknown> = {}): FormStart {
  return { createPath, body, openPath };
}

const qms = (formType: string, title: string, topic: string): FormTemplateSeed => ({
  formKey: formType,
  formId: formType.toUpperCase().replace(/_/g, "-"),
  title,
  topic,
  subjectRoute: `/qms-forms/${formType}`,
  start: blank("/qms-forms", `/qms-forms/${formType}/{id}`, { formType }),
});

export const FORM_TEMPLATES: FormTemplateSeed[] = [
  { formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA Validation Report", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "csa", cells: {} } }) },
  { formKey: "frm-val-007", formId: "FRM-VAL-007", title: "Fuel Pump Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "fuel_pump", cells: {} } }) },
  { formKey: "8d", formId: "8D", title: "8D Problem Solving", topic: "Problem Solving", subjectRoute: "/8d", start: blank("/8d", "/8d/{id}") },
  { formKey: "ncr", formId: "NCR", title: "Nonconformance Report", topic: "Nonconformance", subjectRoute: "/ncr", start: blank("/ncr", "/ncr/{id}", { title: "Nonconformance Report" }) },
  { formKey: "capa", formId: "CAPA", title: "Corrective Action Request", topic: "Nonconformance", subjectRoute: "/capa", start: blank("/capa", "/capa/{id}") },
  { formKey: "supplier-ncr", formId: "SUPPLIER-NCR", title: "Supplier NCR", topic: "Nonconformance", subjectRoute: "/ncr", start: blank("/ncr", "/ncr/{id}", { title: "Supplier NCR" }) },
  { formKey: "deviation-waiver", formId: "DEVIATION-WAIVER", title: "Deviation / Waiver Request", topic: "Nonconformance", subjectRoute: "/qms-forms/deviation_waiver_request", start: blank("/qms-forms", "/qms-forms/deviation_waiver_request/{id}", { formType: "deviation_waiver_request" }) },
  qms("document_revision_record", "Document Revision Record", "Document Control"),
  qms("master_document_register", "Master Document Register", "Document Control"),
  qms("record_retention_log", "Record Retention Log", "Document Control"),
  qms("quality_record_disposition", "Quality Record Disposition Form", "Document Control"),
  qms("quality_objectives_action_plan", "Quality Objectives & Action Plan", "Quality Manual & Policies"),
  qms("management_review_record", "Management Review Record", "Quality Manual & Policies"),
  qms("preventive_risk_action", "Preventive / Risk Reduction Action", "Problem Solving"),
  qms("supplier_qualification_evaluation", "Supplier Qualification & Evaluation", "Supplier Quality"),
  qms("first_article_inspection", "First Article Inspection Report", "Production & Inspection"),
  qms("in_process_inspection", "In-Process Inspection Record", "Production & Inspection"),
  qms("final_inspection_release", "Final Inspection & Release Record", "Production & Inspection"),
  qms("quality_kpi_monitoring", "Quality KPI Monitoring Form", "Production & Inspection"),
  qms("training_matrix", "Training Matrix", "Training"),
  qms("change_control_record", "Change Control Record", "Change Control"),
  qms("audit_finding_action_log", "Audit Finding & Action Log", "Audit"),
  qms("incoming_inspection_record", "Incoming Inspection Record", "Incoming Inspection"),
  qms("design_history_form", "Design History Form", "Design & Development"),
  { formKey: "dcr", formId: "DCR", title: "Document Change Request", topic: "Document Control", subjectRoute: "/document-change-requests", start: blank("/document-change-requests", "/document-change-requests/{id}") },
  { formKey: "risk", formId: "RISK", title: "Risk & Opportunity Assessment", topic: "Risk Management", subjectRoute: "/risk", start: blank("/risk", "/risk/{id}", { title: "Risk & Opportunity Assessment" }) },
  { formKey: "audit-plan", formId: "AUDIT-PLAN", title: "Internal Audit Plan", topic: "Audit", subjectRoute: "/audits", start: blank("/audits", "/audits/{id}", { name: "Internal Audit Plan", type: "internal" }) },
  { formKey: "audit-report", formId: "AUDIT-REPORT", title: "Internal Audit Report", topic: "Audit", subjectRoute: "/audits", start: blank("/audits", "/audits/{id}", { name: "Internal Audit Report", type: "internal" }) },
  { formKey: "cal-register", formId: "CAL-REGISTER", title: "Calibration Equipment Register", topic: "Calibration", subjectRoute: "/calibration", start: blank("/equipment", "/calibration/{id}", { name: "Calibration Equipment Register" }) },
  { formKey: "cal-record", formId: "CAL-RECORD", title: "Calibration Record", topic: "Calibration", subjectRoute: "/calibration", start: blank("/equipment", "/calibration/{id}", { name: "Calibration Record" }) },
  { formKey: "training-record", formId: "TRAINING-RECORD", title: "Training & Competency Record", topic: "Training", subjectRoute: "/training", start: blank("/training", "/training/{id}", { title: "Training & Competency Record" }) },
  { formKey: "complaint", formId: "COMPLAINT", title: "Customer Complaint Record", topic: "Customer Quality", subjectRoute: "/ncr", start: blank("/ncr", "/ncr/{id}", { title: "Customer Complaint Record" }) },
  { formKey: "ecr", formId: "ECR", title: "Engineering Change Request", topic: "Change Control", subjectRoute: "/change", start: blank("/change", "/change/{id}", { title: "Engineering Change Request" }) },
  { formKey: "eco", formId: "ECO", title: "Engineering Change Order", topic: "Change Control", subjectRoute: "/change", start: blank("/change", "/change/{id}", { title: "Engineering Change Order" }) },
];

/** Folders under the ISO documents root for one template: blank-forms folder, then its topic. */
export function templateFolderPath(topic: string): string[] {
  return [BLANK_FORMS_FOLDER, topic];
}

export function filedRecordName(formId: string, recordNumber: number | string, date: string, pattern = FILE_NAME_PATTERN): string {
  return pattern.replaceAll("{formId}", formId).replaceAll("{recordNumber}", String(recordNumber)).replaceAll("{date}", date);
}
