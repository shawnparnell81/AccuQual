import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { users } from "./users.js";
import { tenants } from "./tenants.js";

export const documents = pgTable("documents", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
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
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const documentVersions = pgTable("document_versions", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
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

export type Document = typeof documents.$inferSelect;
export type NewDocument = typeof documents.$inferInsert;
export type DocumentVersion = typeof documentVersions.$inferSelect;
