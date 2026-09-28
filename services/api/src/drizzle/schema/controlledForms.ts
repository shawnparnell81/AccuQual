import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { documentFolders } from "./documentFolders.js";

/**
 * A blank controlled form template (FRM-VAL-001, and later an audit checklist
 * or a training record). The row is listed once in the Forms Library, where
 * a new form is started, and filed in exactly one document-library folder
 * (`folderId`), under ISO Compliance by topic. A filled-in record is a
 * separate row in its subject folder (for these two, `validation_reports`).
 */
export const controlledFormTemplates = pgTable("controlled_form_templates", {
  id: serial("id").primaryKey(),
  formKey: text("form_key").notNull().unique(),
  docId: text("doc_id").notNull(),
  title: text("title").notNull(),
  route: text("route").notNull(),
  folderId: integer("folder_id").references(() => documentFolders.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ControlledFormTemplate = typeof controlledFormTemplates.$inferSelect;
