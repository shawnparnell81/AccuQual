import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "../drizzle/schema/index.js";
import { postgresConnectionConfig } from "./ssl.js";

// Local/docker-compose Postgres never speaks SSL. Hosted providers
// (Supabase, Render Postgres, RDS) require TLS. Production verifies the
// certificate with DATABASE_SSL_CA and will not boot without it. Development
// and test still accept any certificate when no CA is configured. See db/ssl.ts.
const database = postgresConnectionConfig(env.DATABASE_URL, env.DATABASE_SSL_CA);

export const pool = new Pool({
  connectionString: database.connectionString,
  ssl: database.ssl,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
