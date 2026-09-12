import "dotenv/config";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { iotData, digitalTwinModels } from "../../../services/api/src/drizzle/schema/digitalTwin.js";
import { aiRiskScores } from "../../../services/api/src/drizzle/schema/ai.js";

const databaseUrl = process.env.DATABASE_URL ?? "postgres://accuqual:accuqual@localhost:5432/accuqual";

export const pool = new Pool({ connectionString: databaseUrl });
export const db = drizzle(pool, { schema: { iotData, digitalTwinModels, aiRiskScores } });

export { iotData, digitalTwinModels, aiRiskScores };
