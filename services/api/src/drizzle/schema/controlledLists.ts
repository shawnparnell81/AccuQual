import { jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import type { StoredSheet } from "../../modules/controlled-lists/math.js";

/** One living controlled list per company database. Data edits do not change revision. */
export const controlledLists = pgTable("controlled_lists", {
  id: serial("id").primaryKey(),
  listKey: text("list_key").notNull().unique(),
  revision: text("revision").notNull(),
  sheets: jsonb("sheets").$type<StoredSheet[]>().notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});
