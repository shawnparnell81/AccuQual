import "dotenv/config";
import { pool } from "./index.js";
import { provisionCompany } from "./provisionCompany.js";
import { logger } from "../utils/logger.js";

/**
 * Sets up this installation's one company and its first administrator.
 *
 *   npm run db:create-company --workspace services/api -- --name "Acme Manufacturing" --email admin@acme.com [--admin-name "Pat Jones"]
 *
 * On the production image (Render Shell, from /app — npm is not installed there):
 *
 *   node dist/db/createCompany.js --name "Acme Manufacturing" --email admin@acme.com
 *
 * A temporary password is generated, printed once, and emailed to the administrator if email is configured.
 */
function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const name = arg("--name");
  const adminEmail = arg("--email");
  if (!name || !adminEmail) {
    logger.error('Usage: node dist/db/createCompany.js --name "Company name" --email admin@company.com [--admin-name "Full name"]');
    process.exit(1);
  }
  const result = await provisionCompany({ name, adminEmail, adminName: arg("--admin-name") });
  logger.info(`Company "${result.company.name}" created.`);
  logger.info(`Administrator: ${adminEmail}`);
  // Deliberately on the terminal only, never in the log stream: this is the one time the password is shown.
  if (result.temporaryPassword) process.stdout.write(`Temporary password (shown once): ${result.temporaryPassword}
`);
  logger.info(`Welcome email: ${result.emailStatus ?? "not sent"}`);
  await pool.end();
}

main().catch((err) => {
  logger.error("Could not create the company", err);
  process.exit(1);
});
