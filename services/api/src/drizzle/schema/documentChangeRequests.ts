import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * Document Change Request — a real, standalone QMS-document revision-control
 * record, built pixel-for-pixel to a real supplied mockup ("QMS Forms Batch
 * 1", Form 01), the SAME bespoke-standalone-page treatment (deliberately
 * outside the shared FormLayout/GenericFormRenderer engine) already
 * confirmed for the Production Work Order traveler — see workOrders.ts's
 * schema comment for the same tradeoff (no automatic PDF export, its own
 * visual identity).
 *
 * Distinct from `change_requests` (Change Management's PCN — a single
 * product/process change, one row per change): this is a QMS-DOCUMENT
 * revision-control form that can batch several document changes (see
 * `document_change_items` below) under one header and one shared review/
 * approval trail (see `document_change_reviews`) — the two tables this
 * mockup's own two repeatable tables map to.
 *
 * Deliberately ungated (no requireDepartmentAccess) — same convention as
 * Document Control itself (documents.routes.ts's own comment): every
 * authenticated tenant user may raise/edit one, matching how QMS document
 * revisions are typically proposed by whoever owns that document, not one
 * fixed department.
 *
 * status: draft | active | obsolete (the mockup's own 3-checkbox set —
 * the document's own lifecycle state, not an approval workflow with
 * separate transition actions; approvedBy/preparedBy are plain typed names,
 * same "paper form" convention as Work Order's operator/inspector
 * signatures, not a User FK).
 */
export const documentChangeRequests = pgTable("document_change_requests", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  formNo: text("form_no"),
  revision: text("revision"),
  effectiveDate: timestamp("effective_date"),
  preparedBy: text("prepared_by"),
  approvedBy: text("approved_by"),
  status: text("status").notNull().default("draft"),
  additionalComments: text("additional_comments"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** The mockup's "Change Request" table — one row per document/process being changed. */
export const documentChangeItems = pgTable("document_change_items", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
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

/** The mockup's "Review & Approval" table — one row per reviewer's decision. */
export const documentChangeReviews = pgTable("document_change_reviews", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
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
