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
