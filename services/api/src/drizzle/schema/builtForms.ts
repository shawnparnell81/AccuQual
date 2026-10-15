import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { documentFolders } from "./documentFolders.js";

/** A form designed in Form Builder. Filling a copy does not update this row. */
export const builtForms = pgTable("built_forms", {
  id: serial("id").primaryKey(),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  formNumber: text("form_number"),
  revision: text("revision").notNull().default("A"),
  status: text("status").notNull().default("draft"),
  structure: jsonb("structure").notNull(),
  publishedStructure: jsonb("published_structure"),
  folderId: integer("folder_id").references(() => documentFolders.id),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  publishedAt: timestamp("published_at"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/** One row each time the structure is submitted for approval or explicitly re-saved. */
export const builtFormRevisions = pgTable("built_form_revisions", {
  id: serial("id").primaryKey(),
  formId: integer("form_id")
    .references(() => builtForms.id, { onDelete: "cascade" })
    .notNull(),
  revision: text("revision").notNull(),
  structure: jsonb("structure").notNull(),
  summary: text("summary").notNull(),
  savedBy: integer("saved_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  /** pending (waiting for approval), approved, or rejected. Rows from before approval existed count as approved. */
  status: text("status").notNull().default("approved"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  decisionNote: text("decision_note"),
  /** Name and date stamp from the approver's PIN signature. */
  approvalSignature: text("approval_signature"),
});

/** A filled copy. Its structure is the template at the revision it was opened from. */
export const builtFormFills = pgTable("built_form_fills", {
  id: serial("id").primaryKey(),
  formId: integer("form_id")
    .references(() => builtForms.id)
    .notNull(),
  templateRevision: text("template_revision").notNull(),
  templateFormNumber: text("template_form_number"),
  recordNumber: text("record_number"),
  structure: jsonb("structure").notNull(),
  title: text("title").notNull(),
  answers: jsonb("answers").notNull(),
  folderId: integer("folder_id").references(() => documentFolders.id),
  createdBy: integer("created_by").references(() => users.id),
  updatedBy: integer("updated_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

/**
 * Revision history of a built-in form (validation sheets, ISO and QMS forms). The structure lives in the app,
 * so a row records the REV a person typed, what changed, and who approved it. Filled copies keep the REV stamped on them.
 */
export const formRevisionRecords = pgTable("form_revision_records", {
  id: serial("id").primaryKey(),
  formKey: text("form_key").notNull(),
  revision: text("revision").notNull(),
  previousRevision: text("previous_revision"),
  description: text("description").notNull(),
  /** pending, approved, or rejected. */
  status: text("status").notNull().default("pending"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  decisionNote: text("decision_note"),
  approvalSignature: text("approval_signature"),
});

export type BuiltForm = typeof builtForms.$inferSelect;
export type BuiltFormFill = typeof builtFormFills.$inferSelect;
