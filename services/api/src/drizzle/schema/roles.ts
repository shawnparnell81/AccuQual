import { pgTable, serial, text } from "drizzle-orm/pg-core";

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
});

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
