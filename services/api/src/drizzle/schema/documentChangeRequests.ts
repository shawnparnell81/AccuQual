import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Document Change Request — the fillable copy of paper form DCR-F-001
 * (Document Change Request Form). The page is bespoke, outside the shared
 * FormLayout engine, same tradeoff as the work-order traveler.
 *
 * The paper sheet is one requester block and a fixed Official Approval
 * block (requester sign, VP of Engineering and Quality Assurance sign,
 * then Request Executed by / Title / Date). Those answers live on this
 * header. SIGN cells are PIN stamps, not typed names.
 *
 * `document_change_items` and `document_change_reviews` are the previous
 * layout's repeatable tables. They stay so rows saved before DCR-F-001
 * are not deleted. The form no longer edits them. Migration 0096 copies
 * the closest values onto the paper columns.
 *
 * Older header columns (formNo, preparedBy, approvedBy, effectiveDate,
 * additionalComments, status) also stay. status is still draft | active |
 * obsolete for records that already had one. The paper form does not show
 * those checkboxes. `revision` is the software template letter, not the
 * printed Rev. Level on DCR-F-001.
 *
 * Ungated, same convention as Document Control: any signed-in user may
 * raise or edit one.
 */
export const documentChangeRequests = pgTable("document_change_requests", {
  id: serial("id").primaryKey(),
  formNo: text("form_no"),
  revision: text("revision"),
  effectiveDate: timestamp("effective_date"),
  preparedBy: text("prepared_by"),
  approvedBy: text("approved_by"),
  status: text("status").notNull().default("draft"),
  additionalComments: text("additional_comments"),
  requesterName: text("requester_name"),
  requesterTitle: text("requester_title"),
  actionNew: boolean("action_new").notNull().default(false),
  actionRevision: boolean("action_revision").notNull().default(false),
  actionCancellation: boolean("action_cancellation").notNull().default(false),
  docTypeSop: boolean("doc_type_sop").notNull().default(false),
  docTypeBulletin: boolean("doc_type_bulletin").notNull().default(false),
  docTypeTemplate: boolean("doc_type_template").notNull().default(false),
  docTypeForm: boolean("doc_type_form").notNull().default(false),
  documentProcessName: text("document_process_name"),
  currentDocNumber: text("current_doc_number"),
  currentDocRev: text("current_doc_rev"),
  currentDocRevDate: timestamp("current_doc_rev_date"),
  changeDescription: text("change_description"),
  newDocNumber: text("new_doc_number"),
  newDocRev: text("new_doc_rev"),
  newRevDate: timestamp("new_rev_date"),
  requesterApprovalSignature: text("requester_approval_signature"),
  requesterApprovalDate: timestamp("requester_approval_date"),
  vpApprovalSignature: text("vp_approval_signature"),
  vpApprovalDate: timestamp("vp_approval_date"),
  requestExecutedBy: text("request_executed_by"),
  requestExecutedTitle: text("request_executed_title"),
  requestExecutedDate: timestamp("request_executed_date"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** Previous layout's change rows. Kept so saved DCRs are not deleted. The DCR-F-001 form does not edit this table. */
export const documentChangeItems = pgTable("document_change_items", {
  id: serial("id").primaryKey(),
  documentChangeRequestId: integer("document_change_request_id").references(() => documentChangeRequests.id).notNull(),
  changeId: text("change_id"),
  documentProcess: text("document_process"),
  currentRevision: text("current_revision"),
  proposedRevision: text("proposed_revision"),
  reason: text("reason"),
  requestedBy: text("requested_by"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** Previous layout's free-form review rows. Kept so saved DCRs are not deleted. The DCR-F-001 form does not edit this table. */
export const documentChangeReviews = pgTable("document_change_reviews", {
  id: serial("id").primaryKey(),
  documentChangeRequestId: integer("document_change_request_id").references(() => documentChangeRequests.id).notNull(),
  reviewer: text("reviewer"),
  comments: text("comments"),
  decision: text("decision"),
  reviewDate: timestamp("review_date"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type DocumentChangeRequest = typeof documentChangeRequests.$inferSelect;
export type DocumentChangeItem = typeof documentChangeItems.$inferSelect;
export type DocumentChangeReview = typeof documentChangeReviews.$inferSelect;
