import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";
import { logger } from "../utils/logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  logger.info("Ensuring required PostgreSQL extensions...");
  await pool.query("CREATE EXTENSION IF NOT EXISTS vector;"); // pgvector, for ai_embeddings

  logger.info("Running Drizzle migrations...");
  await migrate(db, { migrationsFolder: "./src/drizzle/migrations" });
  logger.info("Migrations complete.");

  logger.info("Applying row-level security policies...");
  const rlsSql = readFileSync(join(__dirname, "../drizzle/post-migrate/rls-policies.sql"), "utf-8");
  await pool.query(rlsSql);
  logger.info("RLS policies applied.");

  logger.info("Applying audit triggers + append-only audit rules...");
  const auditSql = readFileSync(join(__dirname, "../drizzle/post-migrate/audit-triggers.sql"), "utf-8");
  await pool.query(auditSql);
  logger.info("Audit triggers applied.");

  logger.info("Applying version-freeze trigger...");
  const versionFreezeSql = readFileSync(join(__dirname, "../drizzle/post-migrate/version-freeze.sql"), "utf-8");
  await pool.query(versionFreezeSql);
  logger.info("Version-freeze trigger applied.");

  logger.info("Applying indexes...");
  const indexesSql = readFileSync(join(__dirname, "../drizzle/post-migrate/indexes.sql"), "utf-8");
  await pool.query(indexesSql);
  logger.info("Indexes applied.");

  logger.info("Locking down Supabase's default anon/authenticated grants (no-op outside Supabase)...");
  const supabaseLockdownSql = readFileSync(join(__dirname, "../drizzle/post-migrate/supabase-lockdown.sql"), "utf-8");
  await pool.query(supabaseLockdownSql);
  logger.info("Supabase lockdown applied.");

  await pool.end();
}

main().catch((err) => {
  logger.error("Migration failed", err);
  process.exit(1);
});
