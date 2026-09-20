import "dotenv/config";
import winston from "winston";
import { and, eq } from "drizzle-orm";
import { consumeStream } from "./redis-consumer.js";
import { startHeartbeat } from "./heartbeat.js";
import { db, workflowDefinitions, workflowRuns } from "./db.js";
import { executeWorkflow, WorkflowNodeError, type WorkflowDefinition } from "../../../services/api/src/modules/workflow/workflow-engine.js";
// Phase 9 — registers the real action handlers (send_email, create_ncr,
// escalate_capa, ai_suggestion, ...) for THIS process. The API process and
// this worker are separate Node processes with separate module-level
// actionRegistry singletons (see workflow-engine.ts) — each must import
// this once for its own side effect, same reasoning as routes/index.ts's
// own import of it.
import "../../../services/api/src/modules/workflow/workflowActions.js";

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

  // Phase 9 fix — previously matched ANY definition for {module, tenantId}
  // regardless of isActive, so a definition a tenant had deliberately
  // toggled off would still fire for real (a genuine live bug: isActive
  // exists on the schema and the builder UI implies it does something).
  const definitions = await db
    .select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.module, module), eq(workflowDefinitions.tenantId, Number(tenantId)), eq(workflowDefinitions.isActive, "true")));

  for (const definition of definitions) {
    // Real, previously-latent bug found live: node-redis v4's xReadGroup
    // returns each message's field-value map as a null-prototype object, and
    // drizzle's jsonb-column handling does an `instanceof`/prototype-chain
    // check on every column value it's given — passing that object in
    // directly crashes with "Cannot read properties of null (reading
    // 'constructor')" on the very first insert of every real triggered run.
    // Spreading into a plain object (same as runContext below) fixes it.
    const [run] = await db
      .insert(workflowRuns)
      .values({ workflowId: definition.id, tenantId: Number(tenantId), context: { ...fields }, status: "running", simulated: false, definitionVersion: definition.version })
      .returning();
    if (!run) continue;

    // Phase 9 — real action handlers need DB/tenant/actor context (see
    // workflowActions.ts's own comment on this __-prefixed convention).
    // This worker has no human actor — a real system-triggered run, not a
    // user's own request — so __performedBy stays undefined (audit trail's
    // existing "System" fallback already handles a null performer).
    const runContext = { ...fields, entityId, __db: db, __tenantId: Number(tenantId), __performedBy: undefined };

    try {
      const result = await executeWorkflow(definition.definition as unknown as WorkflowDefinition, runContext, { triggerKind: event, dryRun: false });
      const { __db: _db, __tenantId: _tenantId, __performedBy: _performedBy, ...persistable } = result.context;
      // A run that reached an approval node stays open (saved position included) until a person decides — see POST /workflow/runs/:id/decision.
      await db
        .update(workflowRuns)
        .set({
          status: result.status === "waiting_approval" ? "waiting_approval" : "completed",
          context: persistable,
          currentNodeId: result.currentNodeId,
          runState: result.status === "waiting_approval" ? result.state : null,
          finishedAt: result.status === "waiting_approval" ? null : new Date(),
        })
        .where(eq(workflowRuns.id, run.id));
      logger.info(`Workflow "${definition.name}" ${result.status === "waiting_approval" ? "is waiting for approval" : "completed"} for ${module}.${event}`);
    } catch (err) {
      await db
        .update(workflowRuns)
        .set({ status: "failed", error: (err as Error).message, currentNodeId: err instanceof WorkflowNodeError ? err.nodeId : null, finishedAt: new Date() })
        .where(eq(workflowRuns.id, run.id));
      logger.error(`Workflow "${definition.name}" failed`, err);
    }
  }
}

logger.info(`AccuQual workflow-worker listening on ${WORKFLOW_STREAM}`);
startHeartbeat("workflow", REDIS_URL);
consumeStream(REDIS_URL, WORKFLOW_STREAM, "workflow-worker", "consumer-1", handleEvent).catch((err) => {
  logger.error("workflow-worker crashed", err);
  process.exit(1);
});
