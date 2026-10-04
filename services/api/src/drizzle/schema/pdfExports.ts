import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

/**
 * One generated PDF the app already rendered, kept on the API disk with the
 * other attachment files. The export id is the exp_<uuid> printed on the PDF.
 * A later export is a new row. Regenerating does not replace a stored file.
 */
export const pdfExports = pgTable("pdf_exports", {
  id: serial("id").primaryKey(),
  exportId: text("export_id").notNull(),
  sourceModule: text("source_module").notNull(),
  entityType: text("entity_type"),
  entityId: integer("entity_id"),
  recordNumber: text("record_number").notNull().default(""),
  revision: text("revision").notNull().default(""),
  recordStatus: text("record_status"),
  sha256: text("sha256").notNull(),
  fileSize: integer("file_size").notNull(),
  mimeType: text("mime_type").notNull().default("application/pdf"),
  renderer: text("renderer").notNull(),
  filePath: text("file_path").notNull(),
  generatedBy: integer("generated_by").references(() => users.id),
  generatedAt: timestamp("generated_at").notNull(),
  documentId: integer("document_id"),
  folderId: integer("folder_id"),
  attachmentId: integer("attachment_id"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => ({
  exportIdUnique: uniqueIndex("pdf_exports_export_id_idx").on(table.exportId),
}));

/**
 * A legal hold on one controlled record. released_at null means the hold is
 * still in force. Place and release are permissioned; this table does not
 * name a role.
 */
export const legalHolds = pgTable("legal_holds", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  placedBy: integer("placed_by").references(() => users.id),
  placedAt: timestamp("placed_at").notNull().defaultNow(),
  releasedBy: integer("released_by").references(() => users.id),
  releasedAt: timestamp("released_at"),
  reason: text("reason"),
}, (table) => ({
  oneOpenHold: uniqueIndex("legal_holds_active_idx").on(table.entityType, table.entityId).where(sql`released_at IS NULL`),
}));

export type PdfExport = typeof pdfExports.$inferSelect;
export type LegalHold = typeof legalHolds.$inferSelect;
