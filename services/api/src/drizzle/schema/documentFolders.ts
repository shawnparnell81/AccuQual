import { pgTable, serial, text, integer, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { documents } from "./documents.js";

/**
 * A generic, self-referencing folder tree for organizing document types by
 * department (Engineering, Quality, Production, Material Management,
 * Shipping & Receiving, Purchasing, Customer Service) — the taxonomy the
 * user handed over as 7 department folder/subfolder lists. `parentId` null
 * means a top-level department; every other row nests under some other row
 * in this same table, to any depth (the seeded default tree is 3 levels:
 * department -> folder -> document type, but nothing enforces that depth).
 *
 * Any node — but in practice a leaf (no children) — can carry an attached PDF
 * via `pdfPath`, uploaded through POST /document-folders/:id/template. One
 * reserved top-level node per tenant (name === LIBRARY_POOL_NAME) is the
 * "library pool": moving a leaf there (a plain parentId update, same as any
 * other move) is how "remove this form, send it back to the library" works —
 * no separate pool table or status flag needed, it's just another folder.
 */
export const documentFolders = pgTable("document_folders", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  parentId: integer("parent_id").references((): AnyPgColumn => documentFolders.id),
  sortOrder: integer("sort_order").notNull().default(0),
  // Path (under STORAGE_LOCAL_PATH) to a user-uploaded FILE attached to this
  // node — null until someone attaches one; see uploadTemplate in the
  // controller. Independent of the seeded default taxonomy: any node, seeded
  // or user-created, can have a file attached, replaced, or removed. Despite
  // the name (kept for backward compatibility with the column that shipped
  // PDF-only), this now accepts any real document type (docx/xlsx/pdf/
  // images/...) — real policies and procedures aren't always PDFs. The real
  // file extension lives in the path itself; pdfMimeType below carries the
  // real Content-Type for download.
  pdfPath: text("pdf_path"),
  pdfMimeType: text("pdf_mime_type"),
  // A real in-app route (e.g. "/ncr") this leaf corresponds to, for the small
  // subset of the taxonomy that names an actual built-in QMS record type
  // (see linkKnownForms in the controller — self-heals per tenant, matching
  // leaf names against the app's real form types). Independent of pdfPath:
  // a leaf can be linked to a live module AND still carry its own attached
  // reference PDF.
  linkedPath: text("linked_path"),
  // Optional link to a fully version-controlled record in `documents` — for
  // when a leaf needs real revision/approval/expiration/retention tracking
  // instead of (or in addition to) a bare pdfPath. Nullable: most leaves
  // stay simple name-only or pdfPath-only nodes; this is opt-in per leaf via
  // PATCH /document-folders/:id.
  documentId: integer("document_id").references(() => documents.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export const LIBRARY_POOL_NAME = "Library Pool";

export type DocumentFolder = typeof documentFolders.$inferSelect;
