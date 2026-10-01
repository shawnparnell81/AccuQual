import { auditSummaryLayout } from "./auditSummary";
import { auditLayout, concessionLayout, ncrLayout, quarantineLayout, trainingLayout, type FormLayout } from "./isoFormLayouts";
import { pswLayout, qualityAlertLayout, turtleLayout } from "./qualitySheetLayouts";

export const ISO_FORM_TYPES = [
  "internal_audit",
  "ncr_report",
  "quarantine_notice",
  "concession",
  "competency_training",
  "cross_training",
  "psw",
  "turtle_diagram",
  "quality_alert",
  "first_article",
  "customer_scorecard",
  "failure_effectiveness",
  "audit_summary",
  "visitor_log",
  "monthly_engineering",
  "salt_spray",
  "volume_water",
  "volume_heptane",
  "prototype_strut",
  "dev_csa",
  "dev_fuel_pump",
  "dev_gas_lift",
  "dev_coil",
  "dev_air_spring",
  "dev_air_compressor",
  "dev_fuel_injector",
  "dev_electric_lift",
  "dev_air_strut",
  "dev_brake_wear",
  "dev_electronic_shock",
  "dev_electronic_csa",
  "dev_shock",
  "engineering_change",
  "scar_request",
] as const;
export type IsoFormType = (typeof ISO_FORM_TYPES)[number];

export interface IsoFormMeta {
  formKey: string;
  formType: IsoFormType;
  formId: string;
  title: string;
  rev: string;
  layout: FormLayout | null;
  photos: boolean;
  /** Kept so an already filled copy can still open. It is not offered as a new blank. */
  retired?: boolean;
}

/** The old NCR spreadsheet. The live NCR module is separate and stays. */
export const RETIRED_ISO_FORMS: IsoFormMeta[] = [
  { formKey: "frm-ncr-001", formType: "ncr_report", formId: "FRM-NCR-001", title: "NON-CONFORMANCE REPORT (NCR)", rev: "C", layout: ncrLayout(), photos: false, retired: true },
];

export const ISO_FORMS: IsoFormMeta[] = [
  { formKey: "frm-gen-001", formType: "internal_audit", formId: "FRM-GEN-001", title: "AUDIT CHECKLIST", rev: "A", layout: auditLayout(), photos: false },
  { formKey: "frm-ncr-002", formType: "quarantine_notice", formId: "FRM-NCR-002", title: "QUARANTINE NOTICE", rev: "A", layout: quarantineLayout(), photos: true },
  { formKey: "frm-ncr-003", formType: "concession", formId: "FRM-NCR-003", title: "CONCESSION / DEVIATION REQUEST", rev: "A", layout: concessionLayout(), photos: false },
  { formKey: "frm-trn-001", formType: "competency_training", formId: "FRM-TRN-001", title: "COMPETENCY AND TRAINING RECORD", rev: "A", layout: trainingLayout(), photos: false },
  { formKey: "frm-trn-002", formType: "cross_training", formId: "FRM-TRN-002", title: "GRADING RUBRIC: CROSS-TRAINING EVALUATION", rev: "A", layout: null, photos: false },
  { formKey: "frm-psw-001", formType: "psw", formId: "", title: "Part Submission Warrant", rev: "A", layout: pswLayout(), photos: false },
  { formKey: "frm-prc-001", formType: "turtle_diagram", formId: "", title: "Turtle Diagram", rev: "A", layout: turtleLayout(), photos: false },
  { formKey: "frm-qa-001", formType: "quality_alert", formId: "", title: "Quality Alert", rev: "A", layout: qualityAlertLayout(), photos: false },
  { formKey: "frm-fai-001", formType: "first_article", formId: "", title: "First Article Inspection Report", rev: "A", layout: null, photos: false },
  { formKey: "frm-cus-001", formType: "customer_scorecard", formId: "", title: "Customer Scorecard", rev: "A", layout: null, photos: false },
  { formKey: "frm-fae-001", formType: "failure_effectiveness", formId: "", title: "Failure Action Effectiveness Chart", rev: "A", layout: null, photos: false },
  { formKey: "frm-gen-002", formType: "audit_summary", formId: "", title: "INTERNAL AUDIT SUMMARY REPORT", rev: "A", layout: auditSummaryLayout(), photos: false },
  { formKey: "lst-vis-001", formType: "visitor_log", formId: "LST-VIS-001", title: "DMA Laboratory Visitor Log", rev: "A", layout: null, photos: false },
  { formKey: "rpt-eng-001", formType: "monthly_engineering", formId: "", title: "MONTHLY ENGINEERING DEVELOPMENT REPORT", rev: "A", layout: null, photos: false },
  { formKey: "frm-trp-002", formType: "salt_spray", formId: "FRM-TRP-002", title: "SALT SPRAY TEST REPORT (ASTM B117)", rev: "A", layout: null, photos: false },
  { formKey: "frm-tst-001", formType: "volume_water", formId: "", title: "ASTM E542 Gravimetric Volume Calculator", rev: "A", layout: null, photos: false },
  { formKey: "frm-tst-002", formType: "volume_heptane", formId: "", title: "ASTM E542 Gravimetric Volume Calculator", rev: "A", layout: null, photos: false },
  { formKey: "frm-trp-001", formType: "prototype_strut", formId: "FRM-TRP-001", title: "PROTOTYPE EVALUATION REPORT (STRUT ASSEMBLY)", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-001", formType: "dev_csa", formId: "FRM-DEV-001", title: "CSA DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-002", formType: "dev_fuel_pump", formId: "FRM-DEV-002", title: "FUEL PUMP DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-003", formType: "dev_gas_lift", formId: "FRM-DEV-003", title: "GAS LIFT SUPPORT DEVELOPMENT DOCUMENT", rev: "B", layout: null, photos: false },
  { formKey: "frm-dev-004", formType: "dev_coil", formId: "FRM-DEV-004", title: "COIL SPRING DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-005", formType: "dev_air_spring", formId: "FRM-DEV-005", title: "AIR SPRING DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-006", formType: "dev_air_strut", formId: "FRM-DEV-006", title: "AIR STRUT DEVELOPMENT DOCUMENT", rev: "B", layout: null, photos: false },
  { formKey: "frm-dev-007", formType: "dev_brake_wear", formId: "FRM-DEV-007", title: "BRAKE WEAR SENSOR DEVELOPMENT DOCUMENT", rev: "B", layout: null, photos: false },
  { formKey: "frm-dev-008", formType: "dev_electronic_shock", formId: "FRM-DEV-008", title: "ELECTRONIC SHOCK ABSORBER DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-009", formType: "dev_air_compressor", formId: "FRM-DEV-009", title: "AIR COMPRESSOR DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-010", formType: "dev_fuel_injector", formId: "FRM-DEV-010", title: "FUEL INJECTOR DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-011", formType: "dev_electric_lift", formId: "FRM-DEV-011", title: "ELECTRIC LIFT SUPPORT DEVELOPMENT DOCUMENT", rev: "B", layout: null, photos: false },
  { formKey: "frm-dev-012", formType: "dev_electronic_csa", formId: "FRM-DEV-012", title: "ELECTRONIC CSA DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-dev-013", formType: "dev_shock", formId: "FRM-DEV-013", title: "SHOCK ABSORBER DEVELOPMENT DOCUMENT", rev: "A", layout: null, photos: false },
  { formKey: "frm-ecr-001", formType: "engineering_change", formId: "FRM-ECR-001", title: "ENGINEERING CHANGE REQUEST (ECR)", rev: "A", layout: null, photos: false },
  { formKey: "frm-car-001", formType: "scar_request", formId: "FRM-CAR-001", title: "SUPPLIER CORRECTIVE ACTION REQUEST (SCAR)", rev: "A", layout: null, photos: false },
];

export function formByKey(formKey: string | undefined): IsoFormMeta | undefined {
  return ISO_FORMS.find((form) => form.formKey === formKey) ?? RETIRED_ISO_FORMS.find((form) => form.formKey === formKey);
}

export function formByType(formType: string | undefined): IsoFormMeta | undefined {
  return ISO_FORMS.find((form) => form.formType === formType) ?? RETIRED_ISO_FORMS.find((form) => form.formType === formType);
}
