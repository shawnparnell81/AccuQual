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
  // Which department dropdown's permissions (see middleware/departmentAccess.ts)
  // apply to this user: "quality" | "engineering" | "production" |
  // "customer_service" | "purchasing" | "material_management" | null.
  // Independent of roleId — role is job function (manager/operator/auditor),
  // department is which nav dropdown's RWX rules this user gets. Nullable:
  // platform_admin/admin bypass the department matrix entirely, and external
  // supplier/customer portal accounts aren't part of any internal department.
  department: text("department"),
  tokenVersion: integer("token_version").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
