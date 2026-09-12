import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "../../../services/api/src/drizzle/schema/index.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://accuqual:accuqual@localhost:5432/accuqual";

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema });
