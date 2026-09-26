import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { controlledVersions } from "./versioning.js";

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  category: text("category"),
  currentVersion: integer("current_version").notNull().default(1),
  status: text("status").notNull().default("draft"), // draft, in_review, approved, obsolete
  ownerId: integer("owner_id").references(() => users.id),
  isDeleted: boolean("is_deleted").notNull().default(false),
  // Expiration — computed live at read time (documents.controller.ts's
  // expiringStatus), nothing stored beyond the two inputs. No worker.
  expirationDate: timestamp("expiration_date"),
  expirationWarningDays: integer("expiration_warning_days").notNull().default(30),
  // Retention — only meaningful once status is "obsolete" (see
  // applyRetention). retentionState starts "active" and only ever becomes
  // "archived" here; "delete" retentionAction soft-deletes the row instead
  // (isDeleted, same as the rest of this table) rather than needing a third
  // retentionState value for it.
  retentionPeriodDays: integer("retention_period_days").notNull().default(365),
  retentionAction: text("retention_action").notNull().default("archive"), // archive, delete
  retentionState: text("retention_state").notNull().default("active"), // active, archived
  // Controlled-document versioning (modules/documents/documentVersioning.ts). The lifecycle lives in controlled_versions
  // (subject_type 'document'); these columns mirror what is IN FORCE so lists and legacy readers need no join.
  currentVersionId: integer("current_version_id").references(() => controlledVersions.id),
  revisionCode: text("revision_code"), // Rev A, Rev B, ... of the published version
  effectiveDate: timestamp("effective_date"),
  tags: jsonb("tags").$type<string[]>().notNull().default([]),
  linkedModules: jsonb("linked_modules").$type<string[]>().notNull().default([]), // the kinds of record the published version links to
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id).notNull(),
  version: integer("version").notNull(),
  fileUrl: text("file_url"),
  changeNotes: text("change_notes"),
  approvedBy: integer("approved_by").references(() => users.id),
  approvedAt: timestamp("approved_at"),
  // Distinct from changeNotes ("what changed in this revision", written when
  // the version is created) — this is the approver's own note, written at
  // approval time.
  approvalNotes: text("approval_notes"),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * One uploaded file belonging to a controlled document. A row is immutable evidence (name, size, SHA-256 of the exact
 * bytes): versions reference files by id, so a file carried unchanged from revision to revision is stored once, and what a
 * published revision contained can always be proven. Rows are added when a file is uploaded to a draft; the bytes live in
 * the company's own storage folder. Because the path column is called file_path, company data export picks these up.
 */
export const documentFiles = pgTable("document_files", {
  id: serial("id").primaryKey(),
  documentId: integer("document_id").references(() => documents.id).notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  sha256: text("sha256").notNull(),
  filePath: text("file_path").notNull(),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  uploadedAt: timestamp("uploaded_at").defaultNow(),
});

export type DocumentFile = typeof documentFiles.$inferSelect;
export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
