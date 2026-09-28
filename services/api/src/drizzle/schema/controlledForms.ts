import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { documentFolders } from "./documentFolders.js";

/**
 * A controlled form template (FRM-VAL-001, and later an audit checklist or
 * a training record) can be filed in more than one place. The template row
 * is the Forms Library entry. `controlled_form_links` attaches that same
 * template to document-library folders and to Documents-tab categories.
 */
export const controlledFormTemplates = pgTable("controlled_form_templates", {
  id: serial("id").primaryKey(),
  formKey: text("form_key").notNull().unique(),
  docId: text("doc_id").notNull(),
  title: text("title").notNull(),
  route: text("route").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const controlledFormLinks = pgTable("controlled_form_links", {
  id: serial("id").primaryKey(),
  templateId: integer("template_id").references(() => controlledFormTemplates.id).notNull(),
  folderId: integer("folder_id").references(() => documentFolders.id),
  categoryKey: text("category_key"),
});

export type ControlledFormTemplate = typeof controlledFormTemplates.$inferSelect;
export type ControlledFormLink = typeof controlledFormLinks.$inferSelect;
