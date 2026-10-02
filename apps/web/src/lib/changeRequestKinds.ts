/**
 * Keep these overrides aligned with
 * services/api/src/modules/change-requests/changeRequestKinds.ts.
 * The engineering sheet is the template. The other three reuse its cells.
 */
import { ECR_LABEL_DEFAULTS } from "./ecrTemplate";

export type ChangeRequestFormType = "engineering_change" | "drawing_change" | "process_change" | "document_change";

export interface ChangeRequestKind {
  kind: "engineering" | "drawing" | "process" | "document";
  slug: string;
  formType: ChangeRequestFormType;
  formKey: string;
  formId: string;
  title: string;
  noun: string;
  rev: string;
  structureCertify: string;
  managerCertify: string;
  supplierCertify: string;
  labels: Record<string, string>;
}

function withLabels(overrides: Record<string, string>): Record<string, string> {
  return { ...ECR_LABEL_DEFAULTS, ...overrides };
}

export const CHANGE_REQUEST_KINDS: ChangeRequestKind[] = [
  {
    kind: "engineering",
    slug: "engineering-change",
    formType: "engineering_change",
    formKey: "frm-ecr-001",
    formId: "FRM-ECR-001",
    title: "ENGINEERING CHANGE REQUEST (ECR)",
    noun: "engineering change request",
    rev: "B",
    structureCertify: "I certify that I am authorized to change the engineering change request template.",
    managerCertify: "I certify that I approve this engineering change request.",
    supplierCertify: "I certify that I represent the supplier on this engineering change request.",
    labels: { ...ECR_LABEL_DEFAULTS },
  },
  {
    kind: "drawing",
    slug: "drawing-change",
    formType: "drawing_change",
    formKey: "frm-dwg-001",
    formId: "FRM-DWG-001",
    title: "DRAWING CHANGE REQUEST",
    noun: "drawing change request",
    rev: "A",
    structureCertify: "I certify that I am authorized to change the drawing change request template.",
    managerCertify: "I certify that I approve this drawing change request.",
    supplierCertify: "I certify that I represent the supplier on this drawing change request.",
    labels: withLabels({
      partNumbers: "Drawing Number:",
      job: "Part Number(s):",
      newRevision: "Proposed Revision:",
      description: "Marked-up Difference (Current vs. Proposed):",
      reason: "Reason for the Drawing Change:",
      changeSupplier: "Revision",
      changeCost: "Replacement",
      changeQuality: "Withdrawal",
      changeDimensional: "Markup",
      drawingUpdate: "Replace or Withdraw the Drawing?",
      drawingNote: "If YES attach the marked-up drawing.",
      section3: "SECTION 3: REVIEW AND RISK",
      fitFormFunction: "Does this affect Fit, Form, or Function?",
      validationRequired: "Is Validation Required?",
      qcProcedure: "How will the old and new revisions stay separate?",
      implementationPlan: "Planned Release of the New Revision:",
      section4: "SECTION 4: STOCK DISPOSITION (old revision)",
      affectedDrawing: "Drawing Number (link):",
      affectedDocument: "Called-out Specification:",
      affectedProcess: "Related Process:",
      ppapImpact: "Repeat PPAP or Validation?",
      implemented: "Was the new revision released?",
    }),
  },
  {
    kind: "process",
    slug: "process-change",
    formType: "process_change",
    formKey: "frm-pcr-001",
    formId: "FRM-PCR-001",
    title: "PROCESS CHANGE REQUEST",
    noun: "process change request",
    rev: "A",
    structureCertify: "I certify that I am authorized to change the process change request template.",
    managerCertify: "I certify that I approve this process change request.",
    supplierCertify: "I certify that I represent the supplier on this process change request.",
    labels: withLabels({
      partNumbers: "Process Name:",
      currentRevision: "Current Method:",
      job: "Operation:",
      newRevision: "Proposed Method:",
      description: "Current Method vs. Proposed Method:",
      reason: "Reason for the Process Change:",
      changeSupplier: "Method",
      changeCost: "Tooling",
      changeQuality: "Equipment",
      changeDimensional: "Control plan",
      drawingUpdate: "Control Plan or Work Instruction Update?",
      drawingNote: "If YES attach the marked-up document.",
      section3: "SECTION 3: PROCESS REVIEW AND RISK",
      fitFormFunction: "Risk to Fit, Form, or Function?",
      validationRequired: "Validation or Capability Study Required?",
      testPlan: "If YES describe the study:",
      qcProcedure: "Mix-prevention between the old and new method:",
      implementationPlan: "Effectivity Date / First Batch:",
      affectedDocument: "Control Plan or Work Instruction:",
      affectedProcess: "Process or Routing:",
      trainingRequired: "Operator Training Required?",
      ppapImpact: "PPAP or Control-Plan Impact?",
      implemented: "Did the first batch run on the new method?",
    }),
  },
  {
    kind: "document",
    slug: "document-change",
    formType: "document_change",
    formKey: "frm-doc-001",
    formId: "FRM-DOC-001",
    title: "DOCUMENT CHANGE REQUEST",
    noun: "document change request",
    rev: "A",
    structureCertify: "I certify that I am authorized to change the document change request template.",
    managerCertify: "I certify that I approve this document change request.",
    supplierCertify: "I certify that I represent the supplier on this document change request.",
    labels: withLabels({
      partNumbers: "Document Number:",
      job: "Document Title:",
      newRevision: "Proposed Revision:",
      description: "Summary of the Edit:",
      reason: "Reason for the Document Change:",
      changeSupplier: "Revise",
      changeCost: "Add",
      changeQuality: "Retire",
      changeDimensional: "Specification",
      drawingUpdate: "Retire the Old Revision?",
      drawingNote: "Record obsolete, archive, or keep for traceability.",
      section3: "SECTION 3: REVIEW",
      fitFormFunction: "Does this change a released process or part?",
      validationRequired: "Is a Review of Related Documents Required?",
      testPlan: "If YES name the related documents:",
      qcProcedure: "How will the old revision be pulled from use?",
      implementationPlan: "Planned Release Date:",
      section4: "SECTION 4: OLD REVISION DISPOSITION",
      useAsIs: "Archive",
      scrap: "Obsolete",
      rework: "Keep for traceability",
      rawMaterial: "Controlled copy:",
      wip: "Working copy:",
      finishedGoods: "External copy:",
      affectedDrawing: "Related Drawing:",
      affectedDocument: "Document Number (link):",
      affectedProcess: "Related Process or Part:",
      trainingRequired: "Training Required Before Release?",
      customerNotice: "External Distribution Required?",
      ppapImpact: "Related Process Impact?",
      managerSign: "Document Owner / Quality Manager:",
      implemented: "Is the new revision the one in use?",
    }),
  },
];

const BY_TYPE = new Map(CHANGE_REQUEST_KINDS.map((kind) => [kind.formType, kind]));

export function changeRequestByFormType(formType: string | undefined): ChangeRequestKind | undefined {
  if (!formType) return undefined;
  return BY_TYPE.get(formType as ChangeRequestFormType);
}

export function isChangeRequestForm(formType: string | undefined): formType is ChangeRequestFormType {
  return changeRequestByFormType(formType) != null;
}
