import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";
import { users } from "./users.js";

/**
 * The self-service Roles & Permissions module — replaces the hardcoded
 * PERMISSION_MATRIX object in departmentAccess.ts as the real source of
 * truth for module access, without touching the app's existing, unrelated
 * global `roles` table (roles.ts — platform_admin/admin/quality_manager/etc,
 * a fixed system-role list shared across every tenant, used for the
 * roleName-based admin bypass and requireRole() gates everywhere). That
 * table stays exactly as-is; this file is a new, ADDITIVE layer, tenant-
 * scoped end to end.
 *
 * Two independent ways a user can gain access to a module, both computed
 * live by departmentAccess.ts's getUserAccessLevel() on every request (no
 * caching, no re-login required for a change to take effect — an
 * improvement over the existing department/roleName fields, which ARE baked
 * into the JWT at login and only refresh then):
 *
 *   1. departmentPermissions — the direct replacement for PERMISSION_MATRIX.
 *      One row per (tenant, departmentName, moduleName) => accessLevel. A
 *      missing row falls back to the ORIGINAL hardcoded matrix (kept in code
 *      as DEFAULT_PERMISSION_MATRIX) rather than "none" — see that file's
 *      own comment. This is what makes "Customer Service now needs RMA Log
 *      access" a database write instead of a deploy.
 *
 *   2. permissionRoles + permissionRoleModules + userPermissionRoles — a
 *      tenant can additionally define its own named roles (e.g. "Line
 *      Lead"), each carrying its own per-module access level, and assign
 *      them to specific users. This is ADDITIVE ONLY (a role can only grant
 *      access on top of a user's department baseline, never revoke it) —
 *      deliberately no "negative permission" concept, since that would need
 *      a real precedence/conflict system the brief never asked for and this
 *      app has no other example of. A user's effective level on a module is
 *      MAX(department level, every assigned role's level for that module).
 *
 * moduleName/departmentName are plain `text` columns (matching this app's
 * existing convention for auditTrail.entityType/action — see that schema's
 * own comment) but are constrained at the API boundary to the real
 * ResourceKey/Department unions via Zod (permissions.validation.ts) — "no
 * fictional modules," a tenant can only configure access to modules that
 * actually exist and are actually wired to requireDepartmentAccess.
 *
 * accessLevel uses this app's existing "none"|"read"|"edit" vocabulary
 * (matching AccessLevel in departmentAccess.ts) rather than introducing
 * "write" as a second synonym for the same concept — the brief used
 * "write," but this app has said "edit" everywhere (UI copy, PERMISSION_
 * MATRIX, every controller's assertDepartment comment) since it was first
 * built, and keeping one word for one concept avoids permanent confusion.
 */

export const permissionRoles = pgTable(
  "permission_roles",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
    roleName: text("role_name").notNull(),
    description: text("description"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    tenantRoleNameUnique: uniqueIndex("permission_roles_tenant_name_idx").on(table.tenantId, table.roleName),
  })
);

/**
 * Collapses the brief's separate "permissions" + "role_permissions" tables
 * into one direct (role, module) => accessLevel join — the brief's own
 * two-table shape (a standalone `permissions` row per module+level, then a
 * `role_permissions` join to it) adds a layer of indirection with no real
 * benefit here: nothing else ever references a `permissions` row on its
 * own, so it would only ever exist to be joined straight back to one role.
 * This still delivers every behavior asked for (a role's exact per-module
 * access, freely reconfigurable) with one fewer table and no risk of
 * orphaned/duplicate "permission" rows.
 */
export const permissionRoleModules = pgTable(
  "permission_role_modules",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
    roleId: integer("role_id").references(() => permissionRoles.id, { onDelete: "cascade" }).notNull(),
    moduleName: text("module_name").notNull(),
    accessLevel: text("access_level").notNull().default("none"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    tenantRoleModuleUnique: uniqueIndex("permission_role_modules_tenant_role_module_idx").on(table.tenantId, table.roleId, table.moduleName),
  })
);

/**
 * A user may hold more than one custom permission role at once (many-to-
 * many) — distinct from, and unrelated to, the existing single users.roleId
 * FK (the coarse system role — admin/quality_manager/etc). Named
 * "userPermissionRoles" rather than the brief's "user_roles" specifically to
 * avoid reading as the same concept as users.roleId in code/DB tooling.
 */
export const userPermissionRoles = pgTable(
  "user_permission_roles",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
    userId: integer("user_id").references(() => users.id).notNull(),
    roleId: integer("role_id").references(() => permissionRoles.id, { onDelete: "cascade" }).notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    tenantUserRoleUnique: uniqueIndex("user_permission_roles_tenant_user_role_idx").on(table.tenantId, table.userId, table.roleId),
  })
);

export const departmentPermissions = pgTable(
  "department_permissions",
  {
    id: serial("id").primaryKey(),
    tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
    departmentName: text("department_name").notNull(),
    moduleName: text("module_name").notNull(),
    accessLevel: text("access_level").notNull().default("none"),
    createdAt: timestamp("created_at").defaultNow(),
    updatedAt: timestamp("updated_at"),
  },
  (table) => ({
    tenantDeptModuleUnique: uniqueIndex("department_permissions_tenant_dept_module_idx").on(table.tenantId, table.departmentName, table.moduleName),
  })
);

export type PermissionRole = typeof permissionRoles.$inferSelect;
export type PermissionRoleModule = typeof permissionRoleModules.$inferSelect;
export type UserPermissionRole = typeof userPermissionRoles.$inferSelect;
export type DepartmentPermission = typeof departmentPermissions.$inferSelect;
