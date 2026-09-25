import winston from "winston";
import { db } from "./db.js";
import { embedAndStore } from "../../../services/api/src/modules/ai/embedding-engine.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

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
 *
 * Full-System Audit finding H6 — moved out of index.ts (unchanged logic, same
 * function) so it can be imported by test/handle-job.test.ts without also
 * importing index.ts's own top-level consumeStream(...) call, which would
 * start a real, indefinite Redis consumer loop as an import side effect.
 */
export async function handleJob(fields: Record<string, string>) {
  if (fields.job === "embed" && fields.tenantId && fields.entityType && fields.entityId && fields.content) {
    await embedAndStore(db, fields.entityType, Number(fields.entityId), fields.content);
    logger.info(`Embedded ${fields.entityType}#${fields.entityId} (tenant ${fields.tenantId})`);
    return;
  }
  logger.warn(`Unhandled AI job`, fields);
}
