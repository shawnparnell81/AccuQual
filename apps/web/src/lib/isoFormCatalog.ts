import { auditLayout, concessionLayout, ncrLayout, quarantineLayout, trainingLayout, type FormLayout } from "./isoFormLayouts";

export const ISO_FORM_TYPES = ["internal_audit", "ncr_report", "quarantine_notice", "concession", "competency_training", "cross_training"] as const;
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
  { formKey: "frm-gen-001", formType: "internal_audit", formId: "FRM-GEN-001", title: "Internal Audit Checklist", rev: "A", layout: auditLayout(), photos: false },
  { formKey: "frm-ncr-001", formType: "ncr_report", formId: "FRM-NCR-001", title: "Non-Conformance Report", rev: "C", layout: ncrLayout(), photos: false },
  { formKey: "frm-ncr-002", formType: "quarantine_notice", formId: "FRM-NCR-002", title: "Quarantine Notice", rev: "A", layout: quarantineLayout(), photos: true },
  { formKey: "frm-ncr-003", formType: "concession", formId: "FRM-NCR-003", title: "Concession / Deviation Request", rev: "A", layout: concessionLayout(), photos: false },
  { formKey: "frm-trn-001", formType: "competency_training", formId: "FRM-TRN-001", title: "Competency and Training Record", rev: "A", layout: trainingLayout(), photos: false },
  { formKey: "frm-trn-002", formType: "cross_training", formId: "FRM-TRN-002", title: "Cross-Training Evaluation", rev: "A", layout: null, photos: false },
];

export function formByKey(formKey: string | undefined): IsoFormMeta | undefined {
  return ISO_FORMS.find((form) => form.formKey === formKey);
}

export function formByType(formType: string | undefined): IsoFormMeta | undefined {
  return ISO_FORMS.find((form) => form.formType === formType);
}
