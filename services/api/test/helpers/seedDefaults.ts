import { db } from "../../src/db/index.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { INITIAL_DEFAULT_PERMISSIONS } from "../../src/db/defaultPermissions.js";
import type { AccessLevel, Department, ResourceKey } from "../../src/middleware/departmentAccess.js";

/**
 * getUserAccessLevel has no hardcoded fallback left (see
 * departmentAccess.ts's own comment) — a tenant with zero
 * department_permissions rows now genuinely gets "none" everywhere, not the
 * old implicit PERMISSION_MATRIX default. Every real tenant-creation path
 * seeds these rows itself (platform.service.ts's createTenant() for a new
 * tenant, db/backfillDepartmentPermissions.ts for one that already
 * existed) — but these integration tests create their tenant directly via
 * `db.insert(tenants)`, bypassing both. Call this right after creating a
 * test tenant so its users get the same real, non-"none" baseline a
 * production tenant would, matching this app's actual runtime behavior
 * instead of accidentally testing the unseeded edge case everywhere.
 */
export async function seedDefaultPermissions(tenantId: number) {
  const rows: { tenantId: number; departmentName: Department; moduleName: ResourceKey; accessLevel: AccessLevel }[] = [];
  for (const moduleName of Object.keys(INITIAL_DEFAULT_PERMISSIONS) as ResourceKey[]) {
    const perDept = INITIAL_DEFAULT_PERMISSIONS[moduleName];
    for (const departmentName of Object.keys(perDept) as Department[]) {
      const accessLevel = perDept[departmentName];
      if (!accessLevel || accessLevel === "none") continue;
      rows.push({ tenantId, departmentName, moduleName, accessLevel });
    }
  }
  if (rows.length > 0) await db.insert(departmentPermissions).values(rows).onConflictDoNothing();
}
