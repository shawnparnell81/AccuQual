import { pgTable, serial, text, integer, timestamp, boolean } from "drizzle-orm/pg-core";
import { roles } from "./roles.js";
import { tenants } from "./tenants.js";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  // Nullable: platform admins (see modules/platform) manage tenants and are not
  // themselves scoped to one. Every regular application user has a tenantId.
  tenantId: integer("tenant_id").references(() => tenants.id),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: text("name"),
  roleId: integer("role_id").references(() => roles.id),
  tokenVersion: integer("token_version").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
