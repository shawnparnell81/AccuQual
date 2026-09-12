import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { workflowDefinitions, workflowRuns } from "../../../services/api/src/drizzle/schema/workflow.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://accuqual:accuqual@localhost:5432/accuqual";

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema: { workflowDefinitions, workflowRuns } });

export { workflowDefinitions, workflowRuns };
