import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { roles } from "./roles.js";
import { tenants } from "./tenants.js";
import { suppliers } from "./supplier.js";

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
  // Which real supplier company this login belongs to — set ONLY for
  // roleName:"supplier" (Supplier Portal) accounts, the external-login
  // counterpart to `department` above for internal staff. Every
  // supplier-portal route scopes its queries to this id (never trusts a
  // supplierId the client sends), which is how "a supplier can only ever
  // see their own data" is actually enforced, not just hidden in the UI.
  // Null for every internal/admin/platform_admin account.
  supplierId: integer("supplier_id").references(() => suppliers.id),
  tokenVersion: integer("token_version").notNull().default(0),
  isActive: boolean("is_active").notNull().default(true),
  // Phase 7 — Supplier Portal health indicators ("last supplier login").
  // Stamped by auth.service.ts's login() on every successful login, any
  // role — not supplier-specific at the column level, but the only
  // consumer today is the Supplier Portal / internal Supplier health-
  // indicators view, which reads it only for roleName:"supplier" accounts.
  lastLoginAt: timestamp("last_login_at"),
  // This user's own theme overrides, layered on top of their tenant's theme
  // (tenants.branding) — see the Theme System review. mode is "light" |
  // "dark" | "system"; unset means "follow the tenant/default theme" for
  // every field independently, not an all-or-nothing override.
  themePreferences: jsonb("theme_preferences").$type<{ mode?: "light" | "dark" | "system"; primaryColor?: string; accentColor?: string }>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
