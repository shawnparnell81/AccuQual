import "dotenv/config";
import winston from "winston";
import { consumeStream } from "./redis-consumer.js";
import { db } from "./db.js";
import { embedAndStore } from "../../../services/api/src/modules/ai/embedding-engine.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const AI_STREAM = "accuqual:ai-jobs";

/**
 * Consumes background AI jobs queued by the API (see services/api/src/lib/eventBus.ts
 * and utils/crudFactory.ts, which queues an "embed" job on every record creation).
 * Keeps embedding generation off the request path per the AI Engine Spec's pipeline
 * diagram (Preprocessing -> Embedding Generation -> ... runs asynchronously).
 *
 * This worker's own `db` connects as the pool's default (typically owner) role,
 * not through a per-request tenant transaction — every embedding write still
 * carries an explicit `tenantId`, matching the app-level isolation guarantee
 * used everywhere else (see lib/tenantScope.ts).
 */
async function handleJob(fields: Record<string, string>) {
  if (fields.job === "embed" && fields.tenantId && fields.entityType && fields.entityId && fields.content) {
    await embedAndStore(db, Number(fields.tenantId), fields.entityType, Number(fields.entityId), fields.content);
    logger.info(`Embedded ${fields.entityType}#${fields.entityId} (tenant ${fields.tenantId})`);
    return;
  }
  logger.warn(`Unhandled AI job`, fields);
}

logger.info(`AccuQual ai-worker listening on ${AI_STREAM}`);
consumeStream(REDIS_URL, AI_STREAM, "ai-worker", "consumer-1", handleJob).catch((err) => {
  logger.error("ai-worker crashed", err);
  process.exit(1);
});
