import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "../config/env.js";
import * as schema from "../drizzle/schema/index.js";
import { postgresConnectionConfig } from "./ssl.js";

// Local/docker-compose Postgres never speaks SSL. Hosted providers
// (Supabase, Render Postgres, RDS) require TLS. When DATABASE_SSL_CA is a
// PEM, the certificate is verified. Otherwise verification stays off and
// env.ts warns in production (or refuses to boot when
// ACCUQUAL_REQUIRE_DB_SSL_CA=true). See db/ssl.ts.
const database = postgresConnectionConfig(env.DATABASE_URL, env.DATABASE_SSL_CA);

export const pool = new Pool({
  connectionString: database.connectionString,
  ssl: database.ssl,
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;
