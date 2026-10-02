import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { documentFolders } from "./documentFolders.js";

/**
 * One row per blank form template. The Forms Library lists this row.
 * `folderId` is its only home, under ISO Compliance Documents. A filled record is
 * stored by its own module and opened from `subjectRoute`.
 */
export const controlledFormTemplates = pgTable("controlled_form_templates", {
  id: serial("id").primaryKey(),
  formKey: text("form_key").notNull().unique(),
  formId: text("form_id").notNull(),
  title: text("title").notNull(),
  subjectRoute: text("subject_route").notNull(),
  folderId: integer("folder_id").references(() => documentFolders.id),
  // Master Document List overrides for this blank. Null leaves the list cells empty.
  registerApprovalDate: text("register_approval_date"),
  registerApprovedBy: text("register_approved_by"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type ControlledFormTemplate = typeof controlledFormTemplates.$inferSelect;
