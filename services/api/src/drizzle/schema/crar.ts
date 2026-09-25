import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { warrantyClaims } from "./warranty.js";
import { ncr } from "./ncr.js";
import { rma } from "./rma.js";
import { supplierRmaRequests } from "./supplierRma.js";
import { rmaLogRecords } from "./rmaLog.js";
import { customers } from "./customers.js";

/**
 * Customer Return Analysis Report (CRAR) — a real, workflow-driven record
 * of the user's own fillable PDF (Customer_Return_Analysis_Report_Fillable
 * .pdf, fixed for spacing/font-size earlier this session), replicated field
 * for field with ZERO deviation from that form: every column below is one
 * of that PDF's own real AcroForm fields, same name (camelCased, never
 * renamed in spirit), same grouping into the same 13 numbered subsections,
 * same types the form itself implied (its checkboxes are booleans here,
 * its date fields are timestamps, everything else stays text — the PDF
 * itself never typed "Qty Returned" as a number, so neither does this).
 *
 * The 4 fields the ORIGINAL PDF only ever showed as read-only footer
 * echoes (footer_rma/footer_claim/footer_part/footer_date) are NOT
 * separate columns here — they were never independently-entered form
 * data in the PDF (just a live copy of rmaNumber/customerClaim/
 * partNumber/reportDate for print), and a second copy of the same value
 * in a real database would just be a sync-bug waiting to happen. The app's
 * own footer/header chrome recomputes them from the real fields directly.
 * Same reasoning for the PDF's dashed "paste a photo here" evidence boxes
 * (pages 3-5): those were never real AcroForm fields in the source PDF at
 * all (confirmed when the PDF was rebuilt — only checked with pdf-lib's
 * own form introspection), just static illustration placeholders, so
 * real uploads for them go through the existing generic `attachments`
 * table (entityType:"crar") — the same real mechanism Warranty's own
 * evidence photos use — not a new column per placeholder box.
 *
 * status: new | quality_review | warranty_review | completed
 * See crar.controller.ts's ALLOWED_NEXT for the real transition graph.
 */
export const crarClaims = pgTable("crar", {
  id: serial("id").primaryKey(),
  status: text("status").notNull().default("new"),

  // Real relational integration — NOT part of the original PDF's own field
  // set (the PDF has no such concept; a fillable form doesn't know what a
  // "warranty claim" row is), added here as this build's own explicit
  // integration requirement, kept clearly separate from the 54 literal
  // form fields below.
  warrantyId: integer("warranty_id").references(() => warrantyClaims.id),
  // "qualityId" per the brief — AccuQual's real "Quality" module of record
  // for exactly this kind of investigation is the NCR table (there is no
  // separate literal "quality department" entity to link to), so this is
  // an optional link to the NCR this return investigation may already be
  // tracked under.
  qualityId: integer("quality_id").references(() => ncr.id),
  supplierRmaRequestId: integer("supplier_rma_request_id").references(() => supplierRmaRequests.id),
  // The real RMA this report concerns, distinct from the plain `rmaNumber`
  // text field below (the form's own literal field — what a person typed
  // in) — this is the actual foreign key for "Integrated with Supplier RMA
  // workflow".
  linkedRmaId: integer("linked_rma_id").references(() => rma.id),
  // Phase 2 fix ("Ensure CRAR links correctly to Warranty and RMA Log") —
  // warrantyId above already worked; this same real relational link never
  // existed to the RMA Log register (the manual customer-return register,
  // distinct from `rma`/linkedRmaId above and from rma_activity_log) at all.
  rmaLogId: integer("rma_log_id").references(() => rmaLogRecords.id),
  // Phase 2 fix ("Add customer contact fields: email, phone") — rather than
  // duplicating email/phone as new raw text columns here (a second,
  // driftable copy of data the `customers` table already owns, see its own
  // primaryContactEmail/primaryContactPhone), this links to that same real
  // customer record and the contact info is resolved live from there — see
  // crar.controller.ts's getCrarHandler.
  customerId: integer("customer_id").references(() => customers.id),

  // ---- 1. Return / Customer Identification ----
  customerName: text("customer_name"),
  rmaNumber: text("rma_number"),
  customerClaim: text("customer_claim"),
  partNumber: text("part_number"),
  partDescription: text("part_description"),
  qtyReturned: text("qty_returned"),
  reportInitiatedBy: text("report_initiated_by"),
  reportDate: timestamp("report_date"),
  approvedBy: text("approved_by"),
  customerComplaint: text("customer_complaint"), // "Short Description of Customer Complaint"

  // ---- 3. Customer Complaint & Initial Assessment ----
  complaintDetail: text("complaint_detail"), // "Customer Complaint / Claimed Failure"
  dateReceived: timestamp("date_received"),
  receivedBy: text("received_by"),
  conditionOnReceipt: text("condition_on_receipt"),

  // ---- 4. Initial Assessment ----
  assessmentDamage: boolean("assessment_damage").notNull().default(false),
  assessmentMissing: boolean("assessment_missing").notNull().default(false),
  assessmentContamination: boolean("assessment_contamination").notNull().default(false),
  assessmentPackaging: boolean("assessment_packaging").notNull().default(false),
  assessmentMismatch: boolean("assessment_mismatch").notNull().default(false),
  assessmentOther: boolean("assessment_other").notNull().default(false),
  initialAssessmentNotes: text("initial_assessment_notes"),

  // ---- 5. Investigation Plan ----
  investigationPlan: text("investigation_plan"),
  investigator: text("investigator"),
  targetCompletion: timestamp("target_completion"),
  priority: text("priority"),

  // ---- 6. Receiving Documentation / Evidence ----
  evidenceNotes: text("evidence_notes"),

  // ---- 7. Drawings, Specifications & Requirements ----
  drawingSpecNo: text("drawing_spec_no"),
  drawingRevision: text("drawing_revision"),
  applicableRequirement: text("applicable_requirement"),
  acceptanceCriteria: text("acceptance_criteria"),

  // ---- 9. Tests Performed & Test Results ----
  testResults: text("test_results"),
  testedBy: text("tested_by"),
  testDate: timestamp("test_date"),
  overallTestResult: text("overall_test_result"),

  // ---- 10. Findings & Conclusion ----
  findings: text("findings"),
  rootCause: text("root_cause"),
  conclusion: text("conclusion"),

  // ---- 11. Warranty / Customer Return Disposition ----
  warrantyAccepted: boolean("warranty_accepted").notNull().default(false),
  warrantyDenied: boolean("warranty_denied").notNull().default(false),
  acceptedDisposition: text("accepted_disposition"),
  deniedReason: text("denied_reason"),
  dispositionExplanation: text("disposition_explanation"),
  correctiveActionRequired: boolean("corrective_action_required").notNull().default(false),
  engineeringReviewRequired: boolean("engineering_review_required").notNull().default(false),
  carNumber: text("car_number"),
  customerCommunicationDate: timestamp("customer_communication_date"),
  dispositionDate: timestamp("disposition_date"),

  // ---- 12. Approval / Final Record ----
  finalReviewComments: text("final_review_comments"),
  preparedByFinal: text("prepared_by_final"),
  preparedSignature: text("prepared_signature"),
  preparedDate: timestamp("prepared_date"),
  approvedByFinal: text("approved_by_final"),
  approvedSignature: text("approved_signature"),
  approvedDate: timestamp("approved_date"),

  // ---- 13. Record Retention / Closeout ----
  recordLocation: text("record_location"),
  retentionClass: text("retention_class"),
  recordClosed: boolean("record_closed").notNull().default(false),
  customerNotified: boolean("customer_notified").notNull().default(false),
  additionalNotes: text("additional_notes"),

  createdByUserId: integer("created_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type CrarClaim = typeof crarClaims.$inferSelect;
export type NewCrarClaim = typeof crarClaims.$inferInsert;
