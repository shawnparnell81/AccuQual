import "dotenv/config";
import { isNull } from "drizzle-orm";
import { db, pool } from "./index.js";
import { tenants } from "../drizzle/schema/tenants.js";
import { ONBOARDING_CHECKLIST_ITEMS } from "./defaultOnboardingChecklist.js";
import { logger } from "../utils/logger.js";

/**
 * One-time backfill, same shape as backfillNavPreferences.ts: marks the
 * new first-run onboarding checklist all-complete/dismissed for every
 * EXISTING tenant, so a company that's been live for years never suddenly
 * sees a "new tenant" checklist on their dashboard the day this ships.
 * Idempotent — only touches tenants where `onboardingProgress` is still
 * NULL (never seen this feature at all), so re-running never overwrites a
 * tenant that's since made real progress on their own checklist, and never
 * touches a tenant created after this shipped (platform.service.ts's
 * createTenant() already seeds those with a fresh, incomplete checklist).
 */
async function main() {
  const allKeys = ONBOARDING_CHECKLIST_ITEMS.map((i) => i.key);
  const updated = await db
    .update(tenants)
    .set({ onboardingProgress: { dismissed: true, completedItems: [...allKeys] } })
    .where(isNull(tenants.onboardingProgress))
    .returning({ id: tenants.id, code: tenants.code });

  logger.info(`Onboarding checklist backfill: ${updated.length} existing tenant(s) marked dismissed.`);
  for (const t of updated) logger.info(`  Tenant "${t.code}" (#${t.id}): marked dismissed.`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Onboarding checklist backfill failed", err);
  process.exit(1);
});
