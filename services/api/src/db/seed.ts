import "dotenv/config";
import { db, pool } from "./index.js";
import { company } from "../drizzle/schema/company.js";
import { ensureSystemRoles, provisionCompany } from "./provisionCompany.js";
import { logger } from "../utils/logger.js";

/**
 * Seeds the built-in roles and, on a fresh database, a demo company with one administrator for local development.
 * Safe to re-run. A real installation uses `npm run db:create-company` instead.
 */
async function main() {
  logger.info("Seeding AccuQual development data...");
  await ensureSystemRoles();

  const [existing] = await db.select({ id: company.id }).from(company);
  if (!existing) {
    await provisionCompany({ name: "Demo Manufacturing Co.", adminEmail: "admin@accuqual.local", adminName: "Demo Admin", adminPassword: "ChangeMe123!", sendWelcomeEmail: false });
    logger.info("Demo company created.");
  }

  logger.info("Seed complete.");
  logger.info("Demo admin: admin@accuqual.local / ChangeMe123!");
  await pool.end();
}

main().catch((err) => {
  logger.error("Seed failed", err);
  process.exit(1);
});
