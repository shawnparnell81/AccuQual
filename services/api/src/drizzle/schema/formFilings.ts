import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { documentFolders } from "./documentFolders.js";

/**
 * Where one filled copy of an editable quality form was filed, and the
 * document number that copy was given. The live number on the blank master
 * stays on controlled_form_templates.form_id. This row is the snapshot:
 * changing the master later does not rewrite it.
 */
export const formFilings = pgTable(
  "form_filings",
  {
    id: serial("id").primaryKey(),
    formKey: text("form_key").notNull(),
    recordId: integer("record_id").notNull(),
    formNumber: text("form_number").notNull().default(""),
    folderNodeId: integer("folder_node_id").references(() => documentFolders.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [unique("form_filings_form_key_record_id_unique").on(table.formKey, table.recordId)],
);

export type FormFiling = typeof formFilings.$inferSelect;
