import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * ONE generic, reusable attachments table for the whole app — real files a
 * user uploads either as evidence on an existing record (NCR/8D/CAPA/
 * Feasibility/DCR/SCAR/Quality Inspection Report/Risk/Audits/Calibration/
 * Complaints/Change/Work Orders/Training/PPAP/RMA/Suppliers — entityType +
 * entityId set) or as a standalone upload not tied to any record
 * (entityType/entityId both null — a shared, tenant-wide "General Uploads"
 * bin, same "shared QMS records, not personal silos" spirit as every other
 * module in this app). NOT the same as the pre-existing, never-wired-up
 * `ncrAttachments` table in ncr.ts — that one has zero controller/route
 * code anywhere and stayed dead scaffold; this is the real, generic
 * replacement for that idea, reusable by every module instead of one
 * per-module table.
 *
 * Real local-disk storage under
 * `${STORAGE_LOCAL_PATH}/tenants/<tenantId>/attachments/<uuid>-<filename>`
 * (see attachments.controller.ts) — same convention as forms/documents/
 * digital-twin/exports already use (see platform.service.ts's tenant
 * provisioning step 4).
 */
export const attachments = pgTable("attachments", {
  id: serial("id").primaryKey(),
  entityType: text("entity_type"), // ncr | capa | eight_d | feasibility | ... | null for a general upload
  entityId: integer("entity_id"), // null for a general upload
  fileName: text("file_name").notNull(), // original filename, shown in the UI
  filePath: text("file_path").notNull(), // real path on disk
  mimeType: text("mime_type"),
  fileSize: integer("file_size"),
  uploadedBy: integer("uploaded_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type Attachment = typeof attachments.$inferSelect;
