import { integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { StoredSheet } from "../../modules/controlled-lists/math.js";

/** One living controlled list per company database. Data edits do not change revision. */
export const controlledLists = pgTable("controlled_lists", {
  id: serial("id").primaryKey(),
  listKey: text("list_key").notNull().unique(),
  revision: text("revision").notNull(),
  sheets: jsonb("sheets").$type<StoredSheet[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
  /** Master lists open read-only. Edit copies the list here; Cancel puts it back, Save clears it. */
  editSnapshot: jsonb("edit_snapshot").$type<StoredSheet[]>(),
  editRevision: text("edit_revision"),
  editBy: integer("edit_by"),
  editStartedAt: timestamp("edit_started_at"),
});
