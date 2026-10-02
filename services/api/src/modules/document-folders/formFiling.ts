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
 * A stored value that matches the source Doc ID stays.
 * A leftover in this set that is not the source Doc ID is replaced by the source id,
 * or cleared when that workbook has no Doc ID. A number someone typed stays.
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

/** Blank templates taken out of the library. None right now — FRM-NCR-001 is a live blank again. */
export const RETIRED_FORM_KEYS = [] as const;

export const FORM_TEMPLATES: FormTemplateSeed[] = [
  { formKey: "frm-gen-001", formId: "FRM-GEN-001", title: "AUDIT CHECKLIST", topic: "Audit", subjectRoute: "/iso-forms/frm-gen-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "internal_audit", data: { cells: { F3: "Quality & Engineering" } } }) },
  { formKey: "frm-gen-002", formId: "", title: "INTERNAL AUDIT SUMMARY REPORT", topic: "Audit", subjectRoute: "/iso-forms/frm-gen-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "audit_summary", data: { cells: { D5: "Shawn Parnell" } } }) },
  { formKey: "frm-ncr-001", formId: "FRM-NCR-001", title: "NON-CONFORMANCE REPORT (NCR)", topic: "Nonconformance", subjectRoute: "/iso-forms/frm-ncr-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "ncr_report", data: { cells: {} } }) },
  { formKey: "frm-ncr-002", formId: "FRM-NCR-002", title: "QUARANTINE NOTICE", topic: "Nonconformance", subjectRoute: "/iso-forms/frm-ncr-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "quarantine_notice", data: { cells: {} } }) },
  { formKey: "frm-ncr-003", formId: "FRM-NCR-003", title: "CONCESSION / DEVIATION REQUEST", topic: "Nonconformance", subjectRoute: "/iso-forms/frm-ncr-003", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "concession", data: { cells: {} } }) },
  { formKey: "frm-trn-001", formId: "FRM-TRN-001", title: "COMPETENCY AND TRAINING RECORD", topic: "Training", subjectRoute: "/iso-forms/frm-trn-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "competency_training", data: { cells: {} } }) },
  { formKey: "frm-trn-002", formId: "FRM-TRN-002", title: "GRADING RUBRIC: CROSS-TRAINING EVALUATION", topic: "Training", subjectRoute: "/iso-forms/frm-trn-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "cross_training", data: { cells: {} } }) },
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
  { formKey: "frm-val-001", formId: "", title: "CSA VALIDATION REPORT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "csa", cells: {} } }) },
  { formKey: "frm-val-007", formId: "", title: "FUEL PUMP VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "fuel_pump", cells: {} } }) },
  { formKey: "frm-val-010", formId: "FRM-VAL-010", title: "AIR STRUT VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "air_strut", cells: {} } }) },
  { formKey: "frm-val-011", formId: "FRM-VAL-011", title: "AIR STRUT VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "air_spring", cells: {} } }) },
  { formKey: "frm-val-008", formId: "FRM-VAL-008", title: "FUEL INJECTOR VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "fuel_injector", cells: {} } }) },
  { formKey: "frm-val-009", formId: "FRM-VAL-009", title: "BRAKE WEAR SENSOR VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "brake_wear", cells: {} } }) },
  { formKey: "frm-val-002", formId: "FRM-VAL-002", title: "SHOCK VALIDATION REPORT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "shock", cells: {} } }) },
  { formKey: "frm-val-003", formId: "FRM-VAL-009", title: "AIR COMPRESSOR VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "air_compressor", cells: {} } }) },
  { formKey: "frm-val-004", formId: "FRM-VAL-011", title: "ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "electric_lift", cells: {} } }) },
  { formKey: "frm-val-005", formId: "FRM-VAL-007", title: "GAS LIFT SUPPORT VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "gas_lift", cells: {} } }) },
  { formKey: "frm-val-006", formId: "FRM-VAL-006", title: "COIL SPRING VALIDATION DOCUMENT", topic: "Validation", subjectRoute: "/folders/validation-reports", start: blank("/validation-reports", "/validation-reports/{id}", { data: { formType: "coil_spring", cells: {} } }) },
  { formKey: "lst-vis-001", formId: "LST-VIS-001", title: "DMA Laboratory Visitor Log", topic: "Audit", subjectRoute: "/iso-forms/lst-vis-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "visitor_log", data: { cells: { F2: "Lab Entrance", I2: "Maxwell Tollefson" } } }) },
  { formKey: "rpt-eng-001", formId: "", title: "MONTHLY ENGINEERING DEVELOPMENT REPORT", topic: "Engineering", subjectRoute: "/iso-forms/rpt-eng-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "monthly_engineering", data: { cells: { dept: "Product Engineering", prep: "Shawn Parnell" } } }) },
  { formKey: "frm-trp-002", formId: "FRM-TRP-002", title: "SALT SPRAY TEST REPORT (ASTM B117)", topic: "Inspection", subjectRoute: "/iso-forms/frm-trp-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "salt_spray", data: { cells: { E2: "Maxwell Tollefson", B41: "Shawn Parnell" } } }) },
  { formKey: "frm-tst-001", formId: "", title: "ASTM E542 Gravimetric Volume Calculator", topic: "Engineering", subjectRoute: "/iso-forms/frm-tst-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "volume_water", data: { cells: { B10: 8, B11: 0.00001 } } }) },
  { formKey: "frm-tst-002", formId: "", title: "ASTM E542 Gravimetric Volume Calculator", topic: "Engineering", subjectRoute: "/iso-forms/frm-tst-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "volume_heptane", data: { cells: { B10: 8, B11: 0.00001 } } }) },
  { formKey: "frm-trp-001", formId: "FRM-TRP-001", title: "PROTOTYPE EVALUATION REPORT (STRUT ASSEMBLY)", topic: "Engineering", subjectRoute: "/iso-forms/frm-trp-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "prototype_strut", data: { cells: { E2: "Maxwell Tollefson", B58: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-001", formId: "FRM-DEV-001", title: "CSA DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_csa", data: { cells: { E2: "Maxwell Tollefson", B10: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-002", formId: "FRM-DEV-002", title: "FUEL PUMP DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-002", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_fuel_pump", data: { cells: { D2: "Maxwell Tollefson", B8: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-003", formId: "FRM-DEV-003", title: "GAS LIFT SUPPORT DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-003", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_gas_lift", data: { cells: { B3: "Maxwell Tollefson", B9: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-004", formId: "FRM-DEV-004", title: "COIL SPRING DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-004", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_coil", data: { cells: { D2: "Maxwell Tollefson", B10: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-005", formId: "FRM-DEV-005", title: "AIR SPRING DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-005", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_air_spring", data: { cells: { D2: "Maxwell Tollefson", B10: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-006", formId: "FRM-DEV-006", title: "AIR STRUT DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-006", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_air_strut", data: { cells: { F2: "Maxwell Tollefson", B9: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-007", formId: "FRM-DEV-007", title: "BRAKE WEAR SENSOR DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-007", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_brake_wear", data: { cells: { B8: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-008", formId: "FRM-DEV-008", title: "ELECTRONIC SHOCK ABSORBER DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-008", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_electronic_shock", data: { cells: { E2: "Maxwell Tollefson", B9: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-009", formId: "FRM-DEV-009", title: "AIR COMPRESSOR DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-009", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_air_compressor", data: { cells: { D2: "Maxwell Tollefson", B8: "Shawn Parnell", B26: "12.0 VDC" } } }) },
  { formKey: "frm-dev-010", formId: "FRM-DEV-010", title: "FUEL INJECTOR DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-010", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_fuel_injector", data: { cells: { D2: "Maxwell Tollefson", B8: "Shawn Parnell", B28: "14.0 VDC" } } }) },
  { formKey: "frm-dev-011", formId: "FRM-DEV-011", title: "ELECTRIC LIFT SUPPORT DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-011", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_electric_lift", data: { cells: { D2: "Maxwell Tollefson", B8: "Shawn Parnell", B27: "12.0 VDC", B34: "5.0 VDC", B36: "5.0 VDC" } } }) },
  { formKey: "frm-dev-012", formId: "FRM-DEV-012", title: "ELECTRONIC CSA DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-012", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_electronic_csa", data: { cells: { E2: "Maxwell Tollefson", B10: "Shawn Parnell" } } }) },
  { formKey: "frm-dev-013", formId: "FRM-DEV-013", title: "SHOCK ABSORBER DEVELOPMENT DOCUMENT", topic: "Engineering", subjectRoute: "/iso-forms/frm-dev-013", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "dev_shock", data: { cells: { E2: "Maxwell Tollefson", B9: "Shawn Parnell" } } }) },
  { formKey: "frm-ecr-001", formId: "FRM-ECR-001", title: "ENGINEERING CHANGE REQUEST (ECR)", topic: "Change Control", subjectRoute: "/iso-forms/frm-ecr-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "engineering_change", data: { cells: { F2: "Maxwell Tollefson", D5: "Shawn Parnell" } } }) },
  { formKey: "frm-dwg-001", formId: "FRM-DWG-001", title: "DRAWING CHANGE REQUEST", topic: "Change Control", subjectRoute: "/iso-forms/frm-dwg-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "drawing_change", data: { cells: { F2: "Maxwell Tollefson", D5: "Shawn Parnell" } } }) },
  { formKey: "frm-pcr-001", formId: "FRM-PCR-001", title: "PROCESS CHANGE REQUEST", topic: "Change Control", subjectRoute: "/iso-forms/frm-pcr-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "process_change", data: { cells: { F2: "Maxwell Tollefson", D5: "Shawn Parnell" } } }) },
  { formKey: "frm-doc-001", formId: "FRM-DOC-001", title: "DOCUMENT CHANGE REQUEST", topic: "Change Control", subjectRoute: "/iso-forms/frm-doc-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "document_change", data: { cells: { F2: "Maxwell Tollefson", D5: "Shawn Parnell" } } }) },
  { formKey: "frm-car-001", formId: "FRM-CAR-001", title: "SUPPLIER CORRECTIVE ACTION REQUEST (SCAR)", topic: "Nonconformance", subjectRoute: "/iso-forms/frm-car-001", start: blank("/iso-quality-forms", "/iso-forms/record/{id}", { formType: "scar_request", data: { cells: { E2: "Maxwell Tollefson", B7: "Shawn Parnell" } } }) },
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

/** Empty rows take the source Doc ID. A saved custom number stays. A leftover invented id does not. */
export function storedFormId(existing: string, seed: string): string {
  const current = existing.trim();
  const official = seed.trim();
  if (!current) return official;
  if (current === official) return current;
  if (LEGACY_ASSIGNED_FORM_IDS.has(current)) return official;
  return current;
}

export function fileNamePatternFor(seed: { fileNamePattern?: string }): string {
  return seed.fileNamePattern ?? FILE_NAME_PATTERN;
}

export function filedRecordName(formId: string, recordNumber: number | string, date: string, pattern = FILE_NAME_PATTERN): string {
  const id = formId.trim();
  const used = id ? pattern : pattern.replace(/\{formId\}_?/g, "");
  return used.replaceAll("{formId}", id).replaceAll("{recordNumber}", String(recordNumber)).replaceAll("{date}", date);
}
