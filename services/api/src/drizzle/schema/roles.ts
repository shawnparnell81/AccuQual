import { pgTable, serial, text, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const roles = pgTable("roles", {
  id: serial("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description"),
  /** Smaller numbers are higher in the organization and are listed first. */
  hierarchyLevel: integer("hierarchy_level").notNull().default(80),
  /** Built-in roles (Owner, Administrator, and the other seeded names) cannot be deleted or renamed. */
  isProtected: boolean("is_protected").notNull().default(false),
  /** Extra capabilities. `import_data` lets this role use Admin → Import data. `restore_archived_documents` lets an Owner or Administrator return a document from Obsolete / Archive. `form_builder` lets this role create forms and edit their structure. `plants.delete` lets this role delete a plant. Owner and Administrator always have import; restore is only those two roles, and only when this permission is on the role. Plant delete is only this permission — it is not implied by a role name. */
  permissions: jsonb("permissions").$type<string[]>().notNull().default([]),
});

export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
