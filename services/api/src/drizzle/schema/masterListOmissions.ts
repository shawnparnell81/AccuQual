import { integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A row taken off a master list by someone who may edit that list.
 * The underlying document or blank form stays. Equipment removal deletes the
 * equipment record instead, so this table is the Master Document List only.
 */
export const masterListOmissions = pgTable(
  "master_list_omissions",
  {
    id: serial("id").primaryKey(),
    listKey: text("list_key").notNull(),
    source: text("source").notNull(),
    sourceKey: text("source_key").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
    createdBy: integer("created_by").references(() => users.id),
  },
  (table) => [unique("master_list_omissions_row_unique").on(table.listKey, table.source, table.sourceKey)],
);

export type MasterListOmission = typeof masterListOmissions.$inferSelect;
