import { z } from "zod";

export const CRAR_STATUSES = ["new", "quality_review", "warranty_review", "completed"] as const;

/**
 * Every one of the CRAR PDF's own 54 real fields (see crar.ts's own schema
 * comment) — same names, same shape a plain fillable PDF field always has:
 * every field optional, since a person fills this out progressively over
 * the course of an investigation, exactly like the source PDF (nothing on
 * a fillable form is "required" — a blank field is just blank). Which
 * fields a given caller/status may actually touch is enforced inline in
 * crar.controller.ts, the same validate()-vs-inline-guard split every
 * other module in this app uses.
 */
const crarContentFields = {
  // 1. Return / Customer Identification
  customerName: z.string().nullable().optional(),
  rmaNumber: z.string().nullable().optional(),
  customerClaim: z.string().nullable().optional(),
  partNumber: z.string().nullable().optional(),
  partDescription: z.string().nullable().optional(),
  qtyReturned: z.string().nullable().optional(),
  reportInitiatedBy: z.string().nullable().optional(),
  reportDate: z.coerce.date().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  customerComplaint: z.string().nullable().optional(),

  // 3. Customer Complaint & Initial Assessment
  complaintDetail: z.string().nullable().optional(),
  dateReceived: z.coerce.date().nullable().optional(),
  receivedBy: z.string().nullable().optional(),
  conditionOnReceipt: z.string().nullable().optional(),

  // 4. Initial Assessment
  assessmentDamage: z.boolean().optional(),
  assessmentMissing: z.boolean().optional(),
  assessmentContamination: z.boolean().optional(),
  assessmentPackaging: z.boolean().optional(),
  assessmentMismatch: z.boolean().optional(),
  assessmentOther: z.boolean().optional(),
  initialAssessmentNotes: z.string().nullable().optional(),

  // 5. Investigation Plan
  investigationPlan: z.string().nullable().optional(),
  investigator: z.string().nullable().optional(),
  targetCompletion: z.coerce.date().nullable().optional(),
  priority: z.string().nullable().optional(),

  // 6. Receiving Documentation / Evidence
  evidenceNotes: z.string().nullable().optional(),

  // 7. Drawings, Specifications & Requirements
  drawingSpecNo: z.string().nullable().optional(),
  drawingRevision: z.string().nullable().optional(),
  applicableRequirement: z.string().nullable().optional(),
  acceptanceCriteria: z.string().nullable().optional(),

  // 9. Tests Performed & Test Results
  testResults: z.string().nullable().optional(),
  testedBy: z.string().nullable().optional(),
  testDate: z.coerce.date().nullable().optional(),
  overallTestResult: z.string().nullable().optional(),

  // 10. Findings & Conclusion
  findings: z.string().nullable().optional(),
  rootCause: z.string().nullable().optional(),
  conclusion: z.string().nullable().optional(),

  // 11. Warranty / Customer Return Disposition
  warrantyAccepted: z.boolean().optional(),
  warrantyDenied: z.boolean().optional(),
  acceptedDisposition: z.string().nullable().optional(),
  deniedReason: z.string().nullable().optional(),
  dispositionExplanation: z.string().nullable().optional(),
  correctiveActionRequired: z.boolean().optional(),
  engineeringReviewRequired: z.boolean().optional(),
  carNumber: z.string().nullable().optional(),
  customerCommunicationDate: z.coerce.date().nullable().optional(),
  dispositionDate: z.coerce.date().nullable().optional(),

  // 12. Approval / Final Record
  finalReviewComments: z.string().nullable().optional(),
  preparedByFinal: z.string().nullable().optional(),
  preparedSignature: z.string().nullable().optional(),
  preparedDate: z.coerce.date().nullable().optional(),
  approvedByFinal: z.string().nullable().optional(),
  approvedSignature: z.string().nullable().optional(),
  approvedDate: z.coerce.date().nullable().optional(),

  // 13. Record Retention / Closeout
  recordLocation: z.string().nullable().optional(),
  retentionClass: z.string().nullable().optional(),
  recordClosed: z.boolean().optional(),
  customerNotified: z.boolean().optional(),
  additionalNotes: z.string().nullable().optional(),
};

// Real relational integration fields — not part of the PDF's own field set
// (see crar.ts's schema comment), validated separately from the 54 above.
const crarLinkFields = {
  warrantyId: z.coerce.number().int().nullable().optional(),
  qualityId: z.coerce.number().int().nullable().optional(),
  supplierRmaRequestId: z.coerce.number().int().nullable().optional(),
  linkedRmaId: z.coerce.number().int().nullable().optional(),
  // Phase 2 fixes: RMA Log link (was entirely missing) + a real customer
  // link (resolves email/phone from the customers table — see crar.ts's
  // own schema comment on why this isn't just new raw text columns).
  rmaLogId: z.coerce.number().int().nullable().optional(),
  customerId: z.coerce.number().int().nullable().optional(),
};

export const createCrarSchema = z.object({ ...crarContentFields, ...crarLinkFields });
export const updateCrarSchema = z.object({ ...crarContentFields, ...crarLinkFields });

export const transitionCrarSchema = z.object({
  status: z.enum(CRAR_STATUSES),
});
