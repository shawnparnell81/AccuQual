import { pgTable, serial, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * The generic QMS Simple Form engine — backs 35 of the "ACCUQUAL Forms"
 * batch's 37 real forms (see the module review). Every one of those 35
 * shares the exact same shape: one header (Form No./Revision/Effective
 * Date/Prepared By/Approved By/Status draft-active-obsolete) plus 1+ named,
 * freely-addable-row table sections, plus a free-text Additional Comments
 * block — confirmed by extracting all 37 source .docx/.pdf files, not
 * assumed. Rather than 35 near-identical bespoke schemas/controllers/pages
 * (the DocumentChangeRequest/WorkOrder precedent, appropriate for their own
 * genuinely distinct shapes and workflows), this is ONE real schema
 * parameterized by `formType`, with each type's title/subtitle/section
 * column layout declared once in qmsFormDefinitions.ts (mirrored on the
 * frontend) — the two remaining forms of the 37 are NOT here: form 01
 * (Document Change Request) already existed as its own dedicated,
 * already-tested module (documentChangeRequests.ts) before this batch
 * shipped and was only re-skinned to the app's real theme, not
 * re-platformed; form 37 (the rich, 9-section Automotive Manufacturing
 * Work Order) reuses the real, already-workflow-backed `work_orders`
 * module (workOrders.ts) rather than duplicating a second, disconnected
 * production record.
 *
 * Deliberately ungated (no requireDepartmentAccess) — same convention as
 * Document Control and Document Change Request: any authenticated tenant
 * user may raise/edit one, since these are QMS records various departments
 * each own their own subset of, not one department's resource.
 *
 * `data` on qms_form_rows is a free-form jsonb bag rather than one rigid
 * column set — the 35 form types have wildly different table column sets
 * (e.g. "18_Calibration Register"'s Equipment ID/Description/Serial No. vs
 * "22_Customer Complaint"'s Complaint No./Customer/Issue/Severity) that a
 * single fixed-column table could never express; qmsFormDefinitions.ts's
 * per-section column list is what gives each formType's rows real,
 * consistent field names to key into that bag by.
 */
export const qmsForms = pgTable("qms_forms", {
  id: serial("id").primaryKey(),
  formType: text("form_type").notNull(),
  formNo: text("form_no"),
  revision: text("revision"),
  effectiveDate: timestamp("effective_date"),
  preparedBy: text("prepared_by"),
  approvedBy: text("approved_by"),
  status: text("status").notNull().default("draft"), // draft | active | obsolete — every one of the 35 source forms' own 3-checkbox set
  additionalComments: text("additional_comments"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** One row in one named table section of one qms_forms record — sectionKey matches a key in that formType's qmsFormDefinitions.ts entry. */
export const qmsFormRows = pgTable("qms_form_rows", {
  id: serial("id").primaryKey(),
  formId: integer("form_id").references(() => qmsForms.id).notNull(),
  sectionKey: text("section_key").notNull(),
  data: jsonb("data").$type<Record<string, string>>().notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type QmsForm = typeof qmsForms.$inferSelect;
export type QmsFormRow = typeof qmsFormRows.$inferSelect;
