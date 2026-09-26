import "dotenv/config";
import { db, pool } from "./index.js";
import { departmentPermissions } from "../drizzle/schema/permissions.js";
import { INITIAL_DEFAULT_PERMISSIONS } from "./defaultPermissions.js";
import { logger } from "../utils/logger.js";
import type { ResourceKey, Department, AccessLevel } from "../middleware/departmentAccess.js";

/**
 * Adds a department_permissions row for every (department, module) pair INITIAL_DEFAULT_PERMISSIONS defines a
 * non-none level for. Run it after a new ResourceKey is added to defaultPermissions.ts so the new module works for
 * the departments meant to have it. Idempotent (onConflictDoNothing on the table's own (departmentName, moduleName)
 * unique index): safe to re-run, and never touches access levels an administrator already set.
 */
async function main() {
  const rows: { departmentName: Department; moduleName: ResourceKey; accessLevel: AccessLevel }[] = [];
  for (const moduleName of Object.keys(INITIAL_DEFAULT_PERMISSIONS) as ResourceKey[]) {
    const perDept = INITIAL_DEFAULT_PERMISSIONS[moduleName];
    for (const departmentName of Object.keys(perDept) as Department[]) {
      const accessLevel = perDept[departmentName];
      if (!accessLevel || accessLevel === "none") continue;
      rows.push({ departmentName, moduleName, accessLevel });
    }
  }
  const result = rows.length ? await db.insert(departmentPermissions).values(rows).onConflictDoNothing().returning({ id: departmentPermissions.id }) : [];
  logger.info(`Backfill complete: ${result.length} new department_permissions row(s) inserted (${rows.length - result.length} already present).`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Backfill failed", err);
  process.exit(1);
});
