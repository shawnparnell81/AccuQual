import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { roles } from "../../drizzle/schema/roles.js";
import { EXECUTIVE_DASHBOARD_PERMISSION, SITES_VIEW_ALL_PERMISSION } from "./roleAccess.js";

/** Permissions stored on the role row. A role name by itself does not grant these. */
export async function loadRolePermissions(db: Db, roleName: string | null | undefined): Promise<string[]> {
  if (!roleName) return [];
  const [role] = await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.name, roleName));
  return role?.permissions ?? [];
}

export async function roleHasPermission(db: Db, roleName: string | null | undefined, permission: string): Promise<boolean> {
  const list = await loadRolePermissions(db, roleName);
  return list.includes(permission);
}

export async function roleCanViewAllSites(db: Db, roleName: string | null | undefined): Promise<boolean> {
  return roleHasPermission(db, roleName, SITES_VIEW_ALL_PERMISSION);
}

export async function roleHasExecutiveDashboard(db: Db, roleName: string | null | undefined): Promise<boolean> {
  return roleHasPermission(db, roleName, EXECUTIVE_DASHBOARD_PERMISSION);
}
