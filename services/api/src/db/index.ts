import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "../drizzle/schema/index.js";

// Local/docker-compose Postgres never speaks SSL (no cert configured, no
// need to); every real hosted provider this app might point at instead
// (Supabase, RDS, Render Postgres, ...) requires it. `pg` doesn't infer
// this from a `postgres://` connection string on its own, so — rather than
// a new env var every deploy target has to remember to set — this is
// decided once, here, from the hostname: local dev/CI stays plaintext,
// anything else gets SSL. `rejectUnauthorized: false` matches Supabase's
// own connection examples for node-postgres — their pooler's cert chain
// isn't always in Node's default trust store.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);
const isLocalDb = LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocalDb ? undefined : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
