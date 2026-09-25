import "dotenv/config";
import { db, pool } from "./index.js";
import { company } from "../drizzle/schema/company.js";
import { departmentPermissions } from "../drizzle/schema/permissions.js";
import { INITIAL_DEFAULT_PERMISSIONS } from "./defaultPermissions.js";
import { logger } from "../utils/logger.js";
import type { ResourceKey, Department, AccessLevel } from "../middleware/departmentAccess.js";

/**
 * One-time backfill — run once, per explicit user request to fully remove
 * the runtime dependency on the hardcoded PERMISSION_MATRIX. Inserts a real
 * department_permissions row for every EXISTING tenant, for every
 * (department, module) pair INITIAL_DEFAULT_PERMISSIONS defines a non-none
 * level for, so every tenant that existed before this rewrite keeps
 * behaving EXACTLY as it did under the old hardcoded matrix — now as real
 * rows on file instead of an implicit runtime fallback. Idempotent
 * (onConflictDoNothing keyed on the table's own (tenantId, departmentName,
 * moduleName) unique index) — safe to re-run, e.g. after a new ResourceKey
 * is added to defaultPermissions.ts, without touching any tenant's own
 * customizations for keys that already exist.
 *
 * A brand-new tenant never needs this script — platform.service.ts's
 * createTenant() seeds the same rows at creation time.
 */
async function main() {
  const allTenants = await db.select({ id: company.id, code: company.code }).from(company);
  logger.info(`Backfilling department_permissions for ${allTenants.length} tenant(s)...`);

  let inserted = 0;
  for (const tenant of allTenants) {
    const rows: { departmentName: Department; moduleName: ResourceKey; accessLevel: AccessLevel }[] = [];
    for (const moduleName of Object.keys(INITIAL_DEFAULT_PERMISSIONS) as ResourceKey[]) {
      const perDept = INITIAL_DEFAULT_PERMISSIONS[moduleName];
      for (const departmentName of Object.keys(perDept) as Department[]) {
        const accessLevel = perDept[departmentName];
        if (!accessLevel || accessLevel === "none") continue;
        rows.push({ departmentName, moduleName, accessLevel });
      }
    }
    if (rows.length === 0) continue;
    const result = await db.insert(departmentPermissions).values(rows).onConflictDoNothing().returning({ id: departmentPermissions.id });
    inserted += result.length;
    logger.info(`  Tenant "${tenant.code}" (#${tenant.id}): ${result.length} row(s) inserted (${rows.length - result.length} already present).`);
  }

  logger.info(`Backfill complete. ${inserted} new department_permissions row(s) inserted across ${allTenants.length} tenant(s).`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Backfill failed", err);
  process.exit(1);
});
