import "dotenv/config";
import winston from "winston";
import { and, eq } from "drizzle-orm";
import { consumeStream } from "./redis-consumer.js";
import { db, workflowDefinitions, workflowRuns } from "./db.js";
import { runWorkflow, type WorkflowDefinition } from "../../../services/api/src/modules/workflow/workflow-engine.js";

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(winston.format.timestamp(), winston.format.simple()),
  transports: [new winston.transports.Console()],
});

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const WORKFLOW_STREAM = "accuqual:workflow-events";

/**
 * Consumes NCR/CAPA/audit lifecycle events published by the API (see
 * services/api/src/lib/eventBus.ts) and runs every active workflow whose
 * `module` matches the event AND belongs to the same tenant as the event
 * (every event carries `tenantId` — see crudFactory.ts / *.service.ts),
 * using the event's `event` field as the trigger kind (a workflow's trigger
 * node `kind` should match it, e.g. "closed").
 */
async function handleEvent(fields: Record<string, string>) {
  const { module, event, entityId, tenantId } = fields;
  if (!module || !event || !tenantId) return;

  const definitions = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.module, module), eq(workflowDefinitions.tenantId, Number(tenantId))));

  for (const definition of definitions) {
    const [run] = await db
      .insert(workflowRuns)
      .values({ workflowId: definition.id, tenantId: Number(tenantId), context: fields, status: "running" })
      .returning();
    if (!run) continue;

    try {
      const result = await runWorkflow(definition.definition as unknown as WorkflowDefinition, { ...fields, entityId }, event);
      await db.update(workflowRuns).set({ status: "completed", context: result, finishedAt: new Date() }).where(eq(workflowRuns.id, run.id));
      logger.info(`Workflow "${definition.name}" completed for ${module}.${event}`);
    } catch (err) {
      await db
        .update(workflowRuns)
        .set({ status: "failed", error: (err as Error).message, finishedAt: new Date() })
        .where(eq(workflowRuns.id, run.id));
      logger.error(`Workflow "${definition.name}" failed`, err);
    }
  }
}

logger.info(`AccuQual workflow-worker listening on ${WORKFLOW_STREAM}`);
consumeStream(REDIS_URL, WORKFLOW_STREAM, "workflow-worker", "consumer-1", handleEvent).catch((err) => {
  logger.error("workflow-worker crashed", err);
  process.exit(1);
});
