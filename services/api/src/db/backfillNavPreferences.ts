import "dotenv/config";
import { db, pool } from "./index.js";
import { tenants } from "../drizzle/schema/tenants.js";
import { navHiddenItems } from "../drizzle/schema/navPreferences.js";
import { defaultHiddenNavScopes } from "./defaultNavPreferences.js";
import { logger } from "../utils/logger.js";

/**
 * One-time backfill, same shape as backfillDepartmentPermissions.ts: hides
 * the System menu's "advanced" items (Workflow Builder, AI Insights,
 * Digital Twin — see defaultNavPreferences.ts) for every EXISTING tenant,
 * so a tenant that existed before this Phase 1 cleanup gets the same clean
 * default a brand-new tenant now gets automatically from
 * platform.service.ts's createTenant(). Idempotent (onConflictDoNothing on
 * nav_hidden_items' own (tenantId, scope) unique index) — safe to re-run,
 * and never touches a tenant that already explicitly turned one of these
 * back on (that row already exists, so the insert for that scope is simply
 * skipped).
 */
async function main() {
  const allTenants = await db.select({ id: tenants.id, code: tenants.code }).from(tenants);
  const scopes = defaultHiddenNavScopes();
  logger.info(`Backfilling ${scopes.length} default-hidden nav scope(s) for ${allTenants.length} tenant(s)...`);

  let inserted = 0;
  for (const tenant of allTenants) {
    const result = await db
      .insert(navHiddenItems)
      .values(scopes.map((scope) => ({ tenantId: tenant.id, scope })))
      .onConflictDoNothing()
      .returning({ id: navHiddenItems.id });
    inserted += result.length;
    logger.info(`  Tenant "${tenant.code}" (#${tenant.id}): ${result.length} row(s) inserted (${scopes.length - result.length} already present).`);
  }

  logger.info(`Backfill complete. ${inserted} new nav_hidden_items row(s) inserted across ${allTenants.length} tenant(s).`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Backfill failed", err);
  process.exit(1);
});
