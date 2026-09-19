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
// anything else gets SSL.
//
// Security audit finding (high): `rejectUnauthorized: false` alone accepts
// any certificate, including one from an active MITM — it matched
// Supabase's own connection examples, but those trade away verification
// entirely rather than sourcing the provider's CA bundle. When
// DATABASE_SSL_CA is set, this now verifies against it properly instead;
// unset still falls back to the old lenient behavior (env.ts's own boot
// warning is what makes that fallback loud instead of silent).
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "postgres"]);
const isLocalDb = LOCAL_HOSTS.has(new URL(env.DATABASE_URL).hostname);

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  ssl: isLocalDb ? undefined : env.DATABASE_SSL_CA ? { ca: env.DATABASE_SSL_CA, rejectUnauthorized: true } : { rejectUnauthorized: false },
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
