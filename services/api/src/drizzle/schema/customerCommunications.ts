import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { customers } from "./customers.js";

/**
 * Customer Contact & Communications Log — closes the real gap the Buyer
 * Evaluation flagged: Warranty/CRAR already link a claim to a real
 * `customers` row (RmaLog is currently free-text-only, a separate,
 * out-of-scope gap), but nothing anywhere logs an actual conversation with
 * that customer. `customerId` is a required real FK, not another free-text
 * name field — the point of this table is to finally attach real contact
 * history to the real customer record.
 *
 * Files are NOT modeled here as an embedded array — this app already has
 * ONE generic, reusable attachments table (see attachments.ts) wired onto
 * ~19 modules; a comm log's evidence (an email export, a photo, a signed
 * PDF) attaches the same way, via entityType="CustomerCommunication".
 * Duplicating that as embedded JSON here would fragment permissions/
 * deletion/download logic that already exists centrally.
 *
 * `sourceType`/`sourceId` — optional link to whatever real quality record
 * this conversation was about (an NCR or a Complaint) — deliberately the
 * same unconstrained polymorphic pair risk_assessments.ts/
 * feasibility_reviews.ts/customers.ts's own relatedSourceType/
 * relatedSourceId already use, not two separate nullable FK columns; no
 * single FK could target both tables anyway.
 *
 * Immutability: this app has no true write-once table anywhere — every
 * module (NCR, CAPA, Risk, ...) allows a real UPDATE and relies on
 * audit_trail recording the diff (see audit-trail.service.ts's
 * recordAuditTrail, called on every create/update below). Same pattern
 * here, not a new version-chain mechanism.
 */
export const customerCommunications = pgTable("customer_communications", {
  id: serial("id").primaryKey(),
  customerId: integer("customer_id").references(() => customers.id).notNull(),

  commsType: text("comms_type").notNull(), // email | phone | f2f | portal
  occurredAt: timestamp("occurred_at").notNull().defaultNow(), // when the real conversation happened — may be logged after the fact, so deliberately separate from createdAt below
  subject: text("subject"),
  summary: text("summary").notNull(),

  followUpRequired: boolean("follow_up_required").notNull().default(false),
  followUpDate: timestamp("follow_up_date"),

  // Optional link to the real quality record this conversation was about —
  // see this file's own header comment for why this is a polymorphic pair,
  // not linkedNcrId/linkedComplaintId as two separate columns.
  sourceType: text("source_type"), // NCR | Complaint
  sourceId: integer("source_id"),

  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type CustomerCommunication = typeof customerCommunications.$inferSelect;
