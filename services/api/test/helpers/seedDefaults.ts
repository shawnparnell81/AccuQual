import { db } from "../../src/db/index.js";
import { departmentPermissions } from "../../src/drizzle/schema/permissions.js";
import { INITIAL_DEFAULT_PERMISSIONS } from "../../src/db/defaultPermissions.js";
import type { AccessLevel, Department, ResourceKey } from "../../src/middleware/departmentAccess.js";

/**
 * getUserAccessLevel has no hardcoded fallback left (see
 * departmentAccess.ts's own comment) — a company with zero
 * department_permissions rows now genuinely gets "none" everywhere, not the
 * old implicit PERMISSION_MATRIX default. Every real company-creation path
 * seeds these rows itself (platform.service.ts's createCompany() for a new
 * company, db/backfillDepartmentPermissions.ts for one that already
 * existed) — but these integration tests create their company directly via
 * `db.insert(companies)`, bypassing both. Call this right after creating a
 * test company so its users get the same real, non-"none" baseline a
 * production company would, matching this app's actual runtime behavior
 * instead of accidentally testing the unseeded edge case everywhere.
 */
export async function seedDefaultPermissions(companyId: number) {
  const rows: { departmentName: Department; moduleName: ResourceKey; accessLevel: AccessLevel }[] = [];
  for (const moduleName of Object.keys(INITIAL_DEFAULT_PERMISSIONS) as ResourceKey[]) {
    const perDept = INITIAL_DEFAULT_PERMISSIONS[moduleName];
    for (const departmentName of Object.keys(perDept) as Department[]) {
      const accessLevel = perDept[departmentName];
      if (!accessLevel || accessLevel === "none") continue;
      rows.push({ departmentName, moduleName, accessLevel });
    }
  }
  if (rows.length > 0) await db.insert(departmentPermissions).values(rows).onConflictDoNothing();
}

/**
 * Seeds the system roles from ROLE_SEEDS so permission checks by role name
 * (e.g. ncr.closure_signoff) work in tests. Uses onConflictDoNothing to be idempotent.
 */
export async function seedTestRoles() {
  const { ROLE_SEEDS } = await import("../../src/modules/roles/roleHierarchy.js");
  const { roles } = await import("../../src/drizzle/schema/roles.js");
  const { sql } = await import("drizzle-orm");
  for (const seed of ROLE_SEEDS) {
    await db
      .insert(roles)
      .values({
        name: seed.name,
        description: seed.description,
        hierarchyLevel: seed.hierarchyLevel,
        isProtected: seed.isProtected,
        permissions: seed.permissions,
      })
      .onConflictDoUpdate({
        target: roles.name,
        // Append any missing seed permissions to the existing row (don't overwrite).
        set: {
          permissions: sql`(
            SELECT COALESCE(array_agg(DISTINCT p), '{}')
            FROM unnest(COALESCE(${roles.permissions}, '{}') || ${seed.permissions}) AS p
          )`,
        },
      });
  }
}
