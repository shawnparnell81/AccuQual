/**
 * Four ISO change requests share one stage machine. Engineering is the
 * template that is already filled in production. Drawing, process, and
 * document requests clone that sheet: same cells, same reviews, different
 * labels. The existing Document changes page is a different record and is
 * not this sheet.
 *
 * Keep the engineering label strings aligned with
 * apps/web/src/lib/ecrTemplate.ts. Keep the overrides aligned with
 * apps/web/src/lib/changeRequestKinds.ts.
 */

export const CHANGE_REQUEST_LABEL_KEYS = [
  "workflowStatus",
  "section1",
  "dateOfRequest",
  "requestedBy",
  "partNumbers",
  "currentRevision",
  "job",
  "newRevision",
  "section2",
  "changeType",
  "changeSupplier",
  "changeCost",
  "changeQuality",
  "changeDimensional",
  "description",
  "reason",
  "drawingUpdate",
  "drawingNote",
  "section3",
  "fitFormFunction",
  "validationRequired",
  "testPlan",
  "qcProcedure",
  "implementationPlan",
  "section4",
  "useAsIs",
  "scrap",
  "rework",
  "notes",
  "rawMaterial",
  "wip",
  "finishedGoods",
  "section7",
  "affectedDrawing",
  "affectedDocument",
  "affectedProcess",
  "trainingRequired",
  "trainingReference",
  "customerNotice",
  "ppapImpact",
  "section5",
  "managerSign",
  "signDate",
  "supplierSign",
  "section6",
  "implemented",
  "verifiedBy",
] as const;

export type ChangeRequestLabelKey = (typeof CHANGE_REQUEST_LABEL_KEYS)[number];
export type ChangeRequestLabels = Record<ChangeRequestLabelKey, string>;

export const ENGINEERING_LABEL_DEFAULTS: ChangeRequestLabels = {
  workflowStatus: "Workflow Status:",
  section1: "SECTION 1: IDENTIFICATION",
  dateOfRequest: "Date of Request:",
  requestedBy: "Requested By:",
  partNumbers: "Part Number(s) Affected:",
  currentRevision: "Current Revision:",
  job: "Job / Project:",
  newRevision: "New Revision (Proposed):",
  section2: "SECTION 2: CHANGE DETAILS",
  changeType: "Type of Change:",
  changeSupplier: "Supplier Request",
  changeCost: "Cost Reduction",
  changeQuality: "Quality Improvement",
  changeDimensional: "Dimensional Correction",
  description: "Description of Change (Current vs. Proposed):",
  reason: "Reason / Explanation:",
  drawingUpdate: "Drawing Update Required?",
  drawingNote: "If YES attach draft drawing.",
  section3: "SECTION 3: ENGINEERING REVIEW & RISK",
  fitFormFunction: "Does this affect Fit Form or Function?",
  validationRequired: "Is Validation Testing required?",
  testPlan: "If YES describe test plan:",
  qcProcedure: "QC Procedure to Prevent Mixing Parts:",
  implementationPlan: "Planned Implementation Batch/Date:",
  section4: "SECTION 4: STOCK DISPOSITION (What about old parts?)",
  useAsIs: "Use As-Is",
  scrap: "Scrap",
  rework: "Rework",
  notes: "Notes",
  rawMaterial: "Raw Material:",
  wip: "WIP (In Process):",
  finishedGoods: "Finished Goods:",
  section7: "SECTION 7: LINKS, TRAINING, AND IMPACT",
  affectedDrawing: "Affected Drawing:",
  affectedDocument: "Affected Document:",
  affectedProcess: "Affected Process:",
  trainingRequired: "Training Required?",
  trainingReference: "Training Reference:",
  customerNotice: "Customer Notification Required?",
  ppapImpact: "PPAP or Validation Impact?",
  section5: "SECTION 5: AUTHORIZATION",
  managerSign: "DMA Engineering/Quality Manager:",
  signDate: "Date:",
  supplierSign: "Supplier Representative (If Applicable):",
  section6: "SECTION 6: VERIFICATION OF IMPLEMENTATION",
  implemented: "Did the change occur successfully on the planned batch?",
  verifiedBy: "Verified By:",
};

function withLabels(overrides: Partial<ChangeRequestLabels>): ChangeRequestLabels {
  return { ...ENGINEERING_LABEL_DEFAULTS, ...overrides };
}

export type ChangeRequestProfileKey = "ecrTemplate" | "drawingChangeTemplate" | "processChangeTemplate" | "documentChangeTemplate";

export interface ChangeRequestKindDef {
  kind: "engineering" | "drawing" | "process" | "document";
  slug: "engineering-change" | "drawing-change" | "process-change" | "document-change";
  formType: "engineering_change" | "drawing_change" | "process_change" | "document_change";
  formKey: string;
  formId: string;
  title: string;
  /** Spoken name used in audit lines. Engineering wording stays exact. */
  noun: string;
  version: number;
  revision: string;
  profileKey: ChangeRequestProfileKey;
  auditPrefix: string;
  structureCertify: string;
  managerCertify: string;
  supplierCertify: string;
  closeBlocker: string;
  labels: ChangeRequestLabels;
}

export const ENGINEERING_CHANGE: ChangeRequestKindDef = {
  kind: "engineering",
  slug: "engineering-change",
  formType: "engineering_change",
  formKey: "frm-ecr-001",
  formId: "FRM-ECR-001",
  title: "ENGINEERING CHANGE REQUEST (ECR)",
  noun: "engineering change request",
  version: 2,
  revision: "B",
  profileKey: "ecrTemplate",
  auditPrefix: "ecr",
  structureCertify: "I certify that I am authorized to change the engineering change request template.",
  managerCertify: "I certify that I approve this engineering change request.",
  supplierCertify: "I certify that I represent the supplier on this engineering change request.",
  closeBlocker: "Answer whether the change happened on the planned batch before closing.",
  labels: ENGINEERING_LABEL_DEFAULTS,
};

export const DRAWING_CHANGE: ChangeRequestKindDef = {
  kind: "drawing",
  slug: "drawing-change",
  formType: "drawing_change",
  formKey: "frm-dwg-001",
  formId: "FRM-DWG-001",
  title: "DRAWING CHANGE REQUEST",
  noun: "drawing change request",
  version: 1,
  revision: "A",
  profileKey: "drawingChangeTemplate",
  auditPrefix: "drawing_change",
  structureCertify: "I certify that I am authorized to change the drawing change request template.",
  managerCertify: "I certify that I approve this drawing change request.",
  supplierCertify: "I certify that I represent the supplier on this drawing change request.",
  closeBlocker: "Answer whether the new revision was released before closing.",
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
};

export const PROCESS_CHANGE: ChangeRequestKindDef = {
  kind: "process",
  slug: "process-change",
  formType: "process_change",
  formKey: "frm-pcr-001",
  formId: "FRM-PCR-001",
  title: "PROCESS CHANGE REQUEST",
  noun: "process change request",
  version: 1,
  revision: "A",
  profileKey: "processChangeTemplate",
  auditPrefix: "process_change",
  structureCertify: "I certify that I am authorized to change the process change request template.",
  managerCertify: "I certify that I approve this process change request.",
  supplierCertify: "I certify that I represent the supplier on this process change request.",
  closeBlocker: "Answer whether the first batch ran on the new method before closing.",
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
};

export const DOCUMENT_CHANGE: ChangeRequestKindDef = {
  kind: "document",
  slug: "document-change",
  formType: "document_change",
  formKey: "frm-doc-001",
  formId: "FRM-DOC-001",
  title: "DOCUMENT CHANGE REQUEST",
  noun: "document change request",
  version: 1,
  revision: "A",
  profileKey: "documentChangeTemplate",
  auditPrefix: "document_change",
  structureCertify: "I certify that I am authorized to change the document change request template.",
  managerCertify: "I certify that I approve this document change request.",
  supplierCertify: "I certify that I represent the supplier on this document change request.",
  closeBlocker: "Answer whether the new revision is the one in use before closing.",
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
};

export const CHANGE_REQUEST_KINDS = [ENGINEERING_CHANGE, DRAWING_CHANGE, PROCESS_CHANGE, DOCUMENT_CHANGE] as const;

const BY_FORM_TYPE = new Map(CHANGE_REQUEST_KINDS.map((kind) => [kind.formType, kind]));
const BY_SLUG = new Map(CHANGE_REQUEST_KINDS.map((kind) => [kind.slug, kind]));

export function changeRequestByFormType(formType: string | null | undefined): ChangeRequestKindDef | undefined {
  if (!formType) return undefined;
  return BY_FORM_TYPE.get(formType as ChangeRequestKindDef["formType"]);
}

export function changeRequestBySlug(slug: string | null | undefined): ChangeRequestKindDef | undefined {
  if (!slug) return undefined;
  return BY_SLUG.get(slug as ChangeRequestKindDef["slug"]);
}

export function isChangeRequestForm(formType: string | null | undefined): boolean {
  return changeRequestByFormType(formType) != null;
}
