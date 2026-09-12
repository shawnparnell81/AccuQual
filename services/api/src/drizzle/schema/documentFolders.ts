import { pgTable, serial, text, integer, timestamp, type AnyPgColumn } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * A generic, self-referencing folder tree for organizing document types by
 * department (Engineering, Quality, Production, Material Management,
 * Shipping & Receiving, Purchasing, Customer Service) — the taxonomy the
 * user handed over as 7 department folder/subfolder lists. `parentId` null
 * means a top-level department; every other row nests under some other row
 * in this same table, to any depth (the seeded default tree is 3 levels:
 * department -> folder -> document type, but nothing enforces that depth).
 *
 * This is deliberately a pure organizational tree, not yet linked to the
 * `documents` table's actual uploaded file records — attaching real files to
 * a leaf folder is a real next step, not attempted here.
 */
export const documentFolders = pgTable("document_folders", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  name: text("name").notNull(),
  parentId: integer("parent_id").references((): AnyPgColumn => documentFolders.id),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type DocumentFolder = typeof documentFolders.$inferSelect;
