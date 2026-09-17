import "dotenv/config";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { pool } from "./index.js";
import { logger } from "../utils/logger.js";

/**
 * Deliberately NOT wired into db/migrate.ts alongside the RLS/indexes/
 * Supabase-lockdown post-migrate steps: this app's real, documented
 * production deployment is Supabase (see DEPLOY.md), and Supabase does not
 * offer the `timescaledb` extension at all — it's not on their managed
 * Postgres's allowlist (it requires instance-level `shared_preload_libraries`
 * configuration Supabase doesn't expose). Running this automatically as
 * part of every `db:migrate` would hard-fail every real migration run
 * against the actual deployed database with "extension \"timescaledb\" is
 * not available", not just skip harmlessly.
 *
 * This is therefore its own explicit, optional command — real and runnable
 * (previously only a raw `psql -f ...` instruction in the SQL file's own
 * comment, needing a local psql client; this uses the same `pg` Pool every
 * other db:* script already does) — for the one real case it applies to:
 * self-hosting Postgres, or a managed Timescale Cloud instance, specifically
 * for `iot_data`'s time-series query performance at scale. Safe to re-run
 * (the SQL itself is idempotent: `IF NOT EXISTS`/`if_not_exists => TRUE`).
 */
const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const sql = readFileSync(join(__dirname, "../drizzle/post-migrate/timescale-hypertables.sql"), "utf-8");
  logger.info("Applying TimescaleDB hypertable conversion for iot_data...");

  try {
    await pool.query(sql);
    logger.info("iot_data is now a TimescaleDB hypertable.");
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("timescaledb") && message.toLowerCase().includes("not available")) {
      logger.error(
        "The timescaledb extension is not available on this Postgres instance — this is expected " +
          "and unfixable on Supabase (see this script's own comment). It only works against a " +
          "self-hosted Postgres or a managed Timescale Cloud instance with the extension pre-installed."
      );
    } else {
      logger.error("Applying TimescaleDB hypertable conversion failed", err);
    }
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

main();
