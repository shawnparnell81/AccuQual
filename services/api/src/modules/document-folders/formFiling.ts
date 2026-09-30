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
  /** Where a filled record is filed. A live list uses this as a link and leaves `start` empty. */
  subjectRoute: string;
  /** How the Forms Library opens a blank copy. Null means the library opens `subjectRoute` and does not create a record. */
  start: FormStart | null;
  /**
   * Filled-copy file name. Defaults to FILE_NAME_PATTERN.
   * A form with no document number leaves `{formId}` out of this pattern.
   */
  fileNamePattern?: string;
}

function blank(createPath: string, openPath: string, body: Record<string, unknown> = {}): FormStart {
  return { createPath, body, openPath };
}

const qms = (formType: string, title: string, topic: string): FormTemplateSeed => ({
  formKey: formType,
  formId: "",
  title,
  topic,
  subjectRoute: `/qms-forms/${formType}`,
  start: blank("/qms-forms", `/qms-forms/${formType}/{id}`, { formType }),
});

/**
 * Numbers that used to be written onto a master automatically.
 * The next template sync clears them. A number someone typed stays.
 */
export const LEGACY_ASSIGNED_FORM_IDS = new Set([
  "FRM-GEN-001",
  "FRM-NCR-001",
  "FRM-NCR-002",
  "FRM-NCR-003",
  "FRM-TRN-001",
  "FRM-VAL-001",
  "FRM-VAL-007",
  "LST-EQP-001",
  "LST-GEN-001",
  "8D",
  "NCR",
  "CAPA",
  "SUPPLIER-NCR",
  "DEVIATION-WAIVER",
  "DCR",
  "RISK",
  "AUDIT-PLAN",
  "AUDIT-REPORT",
  "CAL-REGISTER",
  "CAL-RECORD",
  "TRAINING-RECORD",
  "COMPLAINT",
  "ECR",
  "ECO",
  "DOCUMENT-REVISION-RECORD",
  "MASTER-DOCUMENT-REGISTER",
  "RECORD-RETENTION-LOG",
  "QUALITY-RECORD-DISPOSITION",
  "QUALITY-OBJECTIVES-ACTION-PLAN",
  "MANAGEMENT-REVIEW-RECORD",
  "PREVENTIVE-RISK-ACTION",
  "SUPPLIER-QUALIFICATION-EVALUATION",
  "FIRST-ARTICLE-INSPECTION",
  "IN-PROCESS-INSPECTION",
  "FINAL-INSPECTION-RELEASE",
  "QUALITY-KPI-MONITORING",
  "TRAINING-MATRIX",
  "CHANGE-CONTROL-RECORD",
  "AUDIT-FINDING-ACTION-LOG",
  "INCOMING-INSPECTION-RECORD",
  "DESIGN-HISTORY-FORM",
]);

export const FORM_TEMPLATES: FormTemplateSeed[] = [
  { formKey: "frm-gen-001", formId: "", title: "Internal Audit Checklist", topic: "Audit", subjectRoute: "/iso-forms/frm-gen-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "internal_audit", data: { cells: { F3: "Quality & Engineering" } } }) },
  { formKey: "frm-gen-002", formId: "", title: "Internal Audit Summary Report", topic: "Audit", subjectRoute: "/iso-forms/frm-gen-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "audit_summary", data: { cells: { D5: "Shawn Parnell" } } }) },
  { formKey: "frm-ncr-001", formId: "", title: "Non-Conformance Report", topic: "Nonconformance", subjectRoute: "/iso-forms/frm-ncr-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "ncr_report", data: { cells: {} } }) },
  { formKey: "frm-ncr-002", formId: "", title: "Quarantine Notice", topic: "Nonconformance", subjectRoute: "/iso-forms/frm-ncr-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "quarantine_notice", data: { cells: {} } }) },
  { formKey: "frm-ncr-003", formId: "", title: "Concession / Deviation Request", topic: "Nonconformance", subjectRoute: "/iso-forms/frm-ncr-003", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "concession", data: { cells: {} } }) },
  { formKey: "frm-trn-001", formId: "", title: "Competency and Training Record", topic: "Training", subjectRoute: "/iso-forms/frm-trn-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "competency_training", data: { cells: {} } }) },
  { formKey: "frm-trn-002", formId: "", title: "Cross-Training Evaluation", topic: "Training", subjectRoute: "/iso-forms/frm-trn-002", fileNamePattern: "CrossTraining_{recordNumber}_{date}", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "cross_training", data: { cells: {} } }) },
  { formKey: "frm-psw-001", formId: "", title: "Part Submission Warrant", topic: "Production & Inspection", subjectRoute: "/iso-forms/frm-psw-001", fileNamePattern: "PSW_{recordNumber}_{date}", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "psw", data: { cells: {} } }) },
  { formKey: "frm-prc-001", formId: "", title: "Turtle Diagram", topic: "Quality Manual & Policies", subjectRoute: "/iso-forms/frm-prc-001", fileNamePattern: "TurtleDiagram_{recordNumber}_{date}", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "turtle_diagram", data: { cells: {} } }) },
  { formKey: "frm-qa-001", formId: "", title: "Quality Alert", topic: "Customer Quality", subjectRoute: "/iso-forms/frm-qa-001", fileNamePattern: "QualityAlert_{recordNumber}_{date}", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "quality_alert", data: { cells: {} } }) },
  { formKey: "frm-fai-001", formId: "", title: "First Article Inspection Report", topic: "Production & Inspection", subjectRoute: "/iso-forms/frm-fai-001", fileNamePattern: "FirstArticle_{recordNumber}_{date}", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "first_article", data: { cells: {}, lines: [] } }) },
  { formKey: "frm-cus-001", formId: "", title: "Customer Scorecard", topic: "Customer Quality", subjectRoute: "/iso-forms/frm-cus-001", fileNamePattern: "CustomerScorecard_{recordNumber}_{date}", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "customer_scorecard", data: { cells: {}, customers: [] } }) },
  { formKey: "frm-fae-001", formId: "", title: "Failure Action Effectiveness Chart", topic: "Problem Solving", subjectRoute: "/iso-forms/frm-fae-001", fileNamePattern: "FailureActionEffectiveness_{recordNumber}_{date}", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "failure_effectiveness", data: { months: [], problems: [] } }) },
  { formKey: "frm-msa-001", formId: "", title: "Gage R&R", topic: "Calibration", subjectRoute: "/calibration", fileNamePattern: "GageRR_{recordNumber}_{date}", start: null },
  { formKey: "frm-par-001", formId: "", title: "Pareto Chart", topic: "Problem Solving", subjectRoute: "/pareto", fileNamePattern: "Pareto_{recordNumber}_{date}", start: null },
  { formKey: "lst-eqp-001", formId: "", title: "Master Equipment List", topic: "Calibration", subjectRoute: "/calibration/master-list", start: null },
  { formKey: "lst-gen-001", formId: "", title: "Master Document List", topic: "Document Control", subjectRoute: "/documents/master-list", start: null },
  { formKey: "frm-val-001", formId: "", title: "CSA Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "csa", cells: {} } }) },
  { formKey: "frm-val-007", formId: "", title: "Fuel Pump Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "fuel_pump", cells: {} } }) },
  { formKey: "frm-val-010", formId: "", title: "Air Strut Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "air_strut", cells: {} } }) },
  { formKey: "frm-val-011", formId: "", title: "Air Spring Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "air_spring", cells: {} } }) },
  { formKey: "frm-val-008", formId: "", title: "Fuel Injector Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "fuel_injector", cells: {} } }) },
  { formKey: "frm-val-009", formId: "", title: "Brake Wear Sensor Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "brake_wear", cells: {} } }) },
  { formKey: "frm-val-002", formId: "", title: "Shock Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "shock", cells: {} } }) },
  { formKey: "frm-val-003", formId: "", title: "Air Compressor Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "air_compressor", cells: {} } }) },
  { formKey: "frm-val-004", formId: "", title: "Electric Lift Support Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "electric_lift", cells: {} } }) },
  { formKey: "frm-val-005", formId: "", title: "Gas Lift Support Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "gas_lift", cells: {} } }) },
  { formKey: "frm-val-006", formId: "", title: "Coil Spring Validation", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "coil_spring", cells: {} } }) },
  { formKey: "lst-vis-001", formId: "", title: "DMA Laboratory Visitor Log", topic: "Audit", subjectRoute: "/iso-forms/lst-vis-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "visitor_log", data: { cells: { F2: "Lab Entrance", I2: "Maxwell Tollefson" } } }) },
  { formKey: "rpt-eng-001", formId: "", title: "Monthly Engineering Development Report", topic: "Engineering", subjectRoute: "/iso-forms/rpt-eng-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "monthly_engineering", data: { cells: { dept: "Product Engineering", prep: "Shawn Parnell" } } }) },
  { formKey: "8d", formId: "", title: "8D Problem Solving", topic: "Problem Solving", subjectRoute: "/8d", start: blank("/8d", "/8d/{id}") },
  { formKey: "ncr", formId: "", title: "Nonconformance Report", topic: "Nonconformance", subjectRoute: "/ncr", start: blank("/ncr", "/ncr/{id}", { title: "Nonconformance Report" }) },
  { formKey: "capa", formId: "", title: "Corrective Action Request", topic: "Nonconformance", subjectRoute: "/capa", start: blank("/capa", "/capa/{id}") },
  { formKey: "supplier-ncr", formId: "", title: "Supplier NCR", topic: "Nonconformance", subjectRoute: "/ncr", start: blank("/ncr", "/ncr/{id}", { title: "Supplier NCR" }) },
  { formKey: "deviation-waiver", formId: "", title: "Deviation / Waiver Request", topic: "Nonconformance", subjectRoute: "/qms-forms/deviation_waiver_request", start: blank("/qms-forms", "/qms-forms/deviation_waiver_request/{id}", { formType: "deviation_waiver_request" }) },
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
  { formKey: "dcr", formId: "", title: "Document Change Request", topic: "Document Control", subjectRoute: "/document-change-requests", start: blank("/document-change-requests", "/document-change-requests/{id}") },
  { formKey: "risk", formId: "", title: "Risk & Opportunity Assessment", topic: "Risk Management", subjectRoute: "/risk", start: blank("/risk", "/risk/{id}", { title: "Risk & Opportunity Assessment" }) },
  { formKey: "audit-plan", formId: "", title: "Internal Audit Plan", topic: "Audit", subjectRoute: "/audits", start: blank("/audits", "/audits/{id}", { name: "Internal Audit Plan", type: "internal" }) },
  { formKey: "audit-report", formId: "", title: "Internal Audit Report", topic: "Audit", subjectRoute: "/audits", start: blank("/audits", "/audits/{id}", { name: "Internal Audit Report", type: "internal" }) },
  { formKey: "cal-register", formId: "", title: "Calibration Equipment Register", topic: "Calibration", subjectRoute: "/calibration", start: blank("/equipment", "/calibration/{id}", { name: "Calibration Equipment Register" }) },
  { formKey: "cal-record", formId: "", title: "Calibration Record", topic: "Calibration", subjectRoute: "/calibration", start: blank("/equipment", "/calibration/{id}", { name: "Calibration Record" }) },
  { formKey: "training-record", formId: "", title: "Training & Competency Record", topic: "Training", subjectRoute: "/training", start: blank("/training", "/training/{id}", { title: "Training & Competency Record" }) },
  { formKey: "complaint", formId: "", title: "Customer Complaint Record", topic: "Customer Quality", subjectRoute: "/ncr", start: blank("/ncr", "/ncr/{id}", { title: "Customer Complaint Record" }) },
  { formKey: "ecr", formId: "", title: "Engineering Change Request", topic: "Change Control", subjectRoute: "/change", start: blank("/change", "/change/{id}", { title: "Engineering Change Request" }) },
  { formKey: "eco", formId: "", title: "Engineering Change Order", topic: "Change Control", subjectRoute: "/change", start: blank("/change", "/change/{id}", { title: "Engineering Change Order" }) },
];

/** Folders under the ISO documents root for one template: blank-forms folder, then its topic. */
export function templateFolderPath(topic: string): string[] {
  return [BLANK_FORMS_FOLDER, topic];
}

export function fileNamePatternFor(seed: { fileNamePattern?: string }): string {
  return seed.fileNamePattern ?? FILE_NAME_PATTERN;
}

export function filedRecordName(formId: string, recordNumber: number | string, date: string, pattern = FILE_NAME_PATTERN): string {
  const id = formId.trim();
  const used = id ? pattern : pattern.replace(/\{formId\}_?/g, "");
  return used.replaceAll("{formId}", id).replaceAll("{recordNumber}", String(recordNumber)).replaceAll("{date}", date);
}
