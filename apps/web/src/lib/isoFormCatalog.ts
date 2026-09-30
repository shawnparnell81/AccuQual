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
}

export const ISO_FORMS: IsoFormMeta[] = [
  { formKey: "frm-gen-001", formType: "internal_audit", formId: "", title: "Internal Audit Checklist", rev: "A", layout: auditLayout(), photos: false },
  { formKey: "frm-ncr-001", formType: "ncr_report", formId: "", title: "Non-Conformance Report", rev: "C", layout: ncrLayout(), photos: false },
  { formKey: "frm-ncr-002", formType: "quarantine_notice", formId: "", title: "Quarantine Notice", rev: "A", layout: quarantineLayout(), photos: true },
  { formKey: "frm-ncr-003", formType: "concession", formId: "", title: "Concession / Deviation Request", rev: "A", layout: concessionLayout(), photos: false },
  { formKey: "frm-trn-001", formType: "competency_training", formId: "", title: "Competency and Training Record", rev: "A", layout: trainingLayout(), photos: false },
  { formKey: "frm-trn-002", formType: "cross_training", formId: "", title: "Cross-Training Evaluation", rev: "A", layout: null, photos: false },
  { formKey: "frm-psw-001", formType: "psw", formId: "", title: "Part Submission Warrant", rev: "A", layout: pswLayout(), photos: false },
  { formKey: "frm-prc-001", formType: "turtle_diagram", formId: "", title: "Turtle Diagram", rev: "A", layout: turtleLayout(), photos: false },
  { formKey: "frm-qa-001", formType: "quality_alert", formId: "", title: "Quality Alert", rev: "A", layout: qualityAlertLayout(), photos: false },
  { formKey: "frm-fai-001", formType: "first_article", formId: "", title: "First Article Inspection Report", rev: "A", layout: null, photos: false },
  { formKey: "frm-cus-001", formType: "customer_scorecard", formId: "", title: "Customer Scorecard", rev: "A", layout: null, photos: false },
  { formKey: "frm-fae-001", formType: "failure_effectiveness", formId: "", title: "Failure Action Effectiveness Chart", rev: "A", layout: null, photos: false },
];

export function formByKey(formKey: string | undefined): IsoFormMeta | undefined {
  return ISO_FORMS.find((form) => form.formKey === formKey);
}

export function formByType(formType: string | undefined): IsoFormMeta | undefined {
  return ISO_FORMS.find((form) => form.formType === formType);
}
