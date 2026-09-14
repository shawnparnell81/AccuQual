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

  logger.info("Applying indexes...");
  const indexesSql = readFileSync(join(__dirname, "../drizzle/post-migrate/indexes.sql"), "utf-8");
  await pool.query(indexesSql);
  logger.info("Indexes applied.");

  await pool.end();
}

main().catch((err) => {
  logger.error("Migration failed", err);
  process.exit(1);
});
