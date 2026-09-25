import type { Db } from "../../lib/requestDb.js";
import { registerActionHandler } from "./workflow-engine.js";
import { sendEmail, notifyDepartment } from "../notifications/notification.service.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { eq, and } from "drizzle-orm";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import type { Department } from "../../middleware/departmentAccess.js";
import { runPipelineAndRecord } from "../ai/ai.usage.js";
import { runWorkflowAiNotePipeline } from "../ai/ai.pipelines.js";
import { triggerErpSync } from "../settings/settings.erpSync.js";

/**
 * Phase 9 task 4 — real action handlers registered into workflow-engine.ts's
 * registry (previously 3 stub handlers that only pushed a marker into
 * context.actionsRun, doing nothing real — see the Phase 9 research). Every
 * handler here respects `dryRun` (Simulation Mode, task 9): it always
 * records what it WOULD do into context.actionsRun, and only performs the
 * real side effect (send an email, insert a row) when `dryRun` is false.
 *
 * Callers (workflow.controller.ts's runHandler, workers/workflow-worker's
 * handleEvent) inject three internal, double-underscore-prefixed context
 * keys before calling runWorkflow — a deliberate convention (not a new
 * parameter on runWorkflow itself, which stays a pure, DB-agnostic
 * function) so the SAME engine code works whether it's called from the API
 * process (a real `Db` inside a request transaction) or the
 * workflow-worker process (its own plain pool connection, tenant-filtered
 * explicitly — see workers/workflow-worker/src/db.ts):
 *   __db: Db-compatible query interface for this tenant
 *   __tenantId: number
 *   __performedBy: number | undefined — the user who triggered this run,
 *     or undefined for a worker-driven run with no human actor (audit
 *     trail's own `performedBy` is already nullable for exactly this case
 *     — see audit-trail.service.ts's "System" convention).
 */

function render(template: string, context: Record<string, unknown>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => (context[key] !== undefined && context[key] !== null ? String(context[key]) : `{{${key}}}`));
}

/**
 * A run triggered by the real workflow-worker carries context fields
 * straight off a Redis Stream message — every field arrives as a plain
 * string there (Redis Streams have no numeric type), even though the SAME
 * field is a real number when a run is triggered directly via POST
 * /workflow/:id/run with a JSON body. Every numeric context field this
 * file reads (supplierId, ncrId, entityId) goes through this first, so a
 * handler behaves identically regardless of which caller triggered it.
 */
function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) return Number(value);
  return undefined;
}

function recordActionRun(context: Record<string, unknown>, kind: string, detail: Record<string, unknown>): void {
  context.actionsRun = [...((context.actionsRun as unknown[]) ?? []), { kind, ...detail }];
}

function cleanContext(context: Record<string, unknown>): Record<string, unknown> {
  const { __db: _db, __performedBy: _performedBy, ...rest } = context;
  return rest;
}

/** Assignable modules — the real per-table "who owns this" column each supports today. */
const ASSIGNABLE: Record<string, { table: typeof ncr | typeof capa | typeof eightD; column: "assignedTo" | "ownerId" }> = {
  ncr: { table: ncr, column: "assignedTo" },
  capa: { table: capa, column: "ownerId" },
};

registerActionHandler("send_email", async (node, context, dryRun) => {
  const config = node.config as { to?: string; toField?: string; subject?: string; body?: string };
  const to = config.to ?? (config.toField ? (context[config.toField] as string | undefined) : undefined);
  const subject = render(config.subject ?? "AccuQual workflow notification", context);
  const body = render(config.body ?? "", context);

  if (!to) {
    recordActionRun(context, "send_email", { skipped: true, reason: "no recipient resolved" });
    return;
  }
  if (dryRun) {
    recordActionRun(context, "send_email", { simulated: true, to, subject });
    return;
  }

  const status = await sendEmail({ to, subject, body });
  const db = context.__db as Db | undefined;
  if (db) await db.insert(notificationLog).values({ channel: "email", recipient: to, subject, body, status, relatedEntityType: "WorkflowRun" });
  recordActionRun(context, "send_email", { to, subject, status });
});

registerActionHandler("notify_department", async (node, context, dryRun) => {
  const config = node.config as { department?: Department; subject?: string; body?: string };
  if (!config.department) {
    recordActionRun(context, "notify_department", { skipped: true, reason: "no department configured" });
    return;
  }
  const subject = render(config.subject ?? "AccuQual workflow notification", context);
  const body = render(config.body ?? "", context);

  if (dryRun) {
    recordActionRun(context, "notify_department", { simulated: true, department: config.department, subject });
    return;
  }
  const db = context.__db as Db | undefined;
  if (!db) {
    recordActionRun(context, "notify_department", { skipped: true, reason: "no database context available" });
    return;
  }
  const recipientCount = await notifyDepartment(db, { department: config.department, subject, body });
  recordActionRun(context, "notify_department", { department: config.department, subject, recipientCount });
});

registerActionHandler("notify_supplier", async (node, context, dryRun) => {
  const config = node.config as { subject?: string; body?: string };
  const supplierId = toNumber(context.supplierId);
  const db = context.__db as Db | undefined;
  if (!supplierId || !db) {
    recordActionRun(context, "notify_supplier", { skipped: true, reason: "no supplierId in this event's context" });
    return;
  }

  const subject = render(config.subject ?? "AccuQual notification", context);
  const body = render(config.body ?? "", context);

  if (dryRun) {
    recordActionRun(context, "notify_supplier", { simulated: true, supplierId, subject });
    return;
  }

  const [supplier] = await db.select({ contactEmail: suppliers.contactEmail }).from(suppliers).where(and(eq(suppliers.id, supplierId)));
  if (!supplier?.contactEmail) {
    recordActionRun(context, "notify_supplier", { skipped: true, reason: "supplier has no contact email on file" });
    return;
  }
  const status = await sendEmail({ to: supplier.contactEmail, subject, body });
  await db.insert(notificationLog).values({ channel: "email", recipient: supplier.contactEmail, subject, body, status, relatedEntityType: "Supplier", relatedEntityId: supplierId });
  recordActionRun(context, "notify_supplier", { supplierId, subject, status });
});

registerActionHandler("create_ncr", async (node, context, dryRun) => {
  const config = node.config as { title?: string; description?: string; severity?: string };
  const title = render(config.title ?? "NCR auto-created by workflow", context);
  const description = render(config.description ?? "", context);

  if (dryRun) {
    recordActionRun(context, "create_ncr", { simulated: true, title, severity: config.severity ?? null });
    return;
  }
  const db = context.__db as Db | undefined;
  if (!db) {
    recordActionRun(context, "create_ncr", { skipped: true, reason: "no database context available" });
    return;
  }

  const [created] = await db
    .insert(ncr)
    .values({
      title,
      description,
      severity: config.severity,
      supplierId: toNumber(context.supplierId),
      receivingLineItemId: toNumber(context.receivingLineItemId),
      createdBy: context.__performedBy as number | undefined,
    })
    .returning();

  await recordAuditTrail(db, {
    entityType: "NCR",
    entityId: created!.id,
    action: "create",
    changes: { message: "NCR auto-created by workflow action", workflowNode: node.id },
    performedBy: context.__performedBy as number | undefined,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "ncr", event: "created", entityId: created!.id });
  recordActionRun(context, "create_ncr", { ncrId: created!.id, title });
});

registerActionHandler("escalate_capa", async (node, context, dryRun) => {
  const config = node.config as { rootCause?: string };
  const rootCause = render(config.rootCause ?? "CAPA escalated by workflow action.", context);
  const ncrId = toNumber(context.ncrId);

  if (dryRun) {
    recordActionRun(context, "escalate_capa", { simulated: true, rootCause, ncrId: ncrId ?? null });
    return;
  }
  const db = context.__db as Db | undefined;
  if (!db) {
    recordActionRun(context, "escalate_capa", { skipped: true, reason: "no database context available" });
    return;
  }

  const [created] = await db
    .insert(capa)
    .values({
      ncrId,
      rootCause,
      status: "open",
      escalationSource: "workflow_escalation",
      supplierId: toNumber(context.supplierId),
    })
    .returning();

  await recordAuditTrail(db, {
    entityType: "CAPA",
    entityId: created!.id,
    action: "create",
    changes: { message: "CAPA escalation triggered by workflow action", workflowNode: node.id },
    performedBy: context.__performedBy as number | undefined,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "capa", event: "escalated", entityId: created!.id });
  recordActionRun(context, "escalate_capa", { capaId: created!.id });
});

registerActionHandler("assign_user", async (node, context, dryRun) => {
  const config = node.config as { module?: string; userId?: number };
  const assignable = config.module ? ASSIGNABLE[config.module] : undefined;
  const entityId = toNumber(context.entityId);
  const userId = toNumber(config.userId);

  if (!assignable || !entityId || !userId) {
    recordActionRun(context, "assign_user", { skipped: true, reason: "module/entityId/userId not resolvable" });
    return;
  }
  if (dryRun) {
    recordActionRun(context, "assign_user", { simulated: true, module: config.module, entityId, userId });
    return;
  }
  const db = context.__db as Db | undefined;
  if (!db) {
    recordActionRun(context, "assign_user", { skipped: true, reason: "no database context available" });
    return;
  }

  const table = assignable.table;
  await db.update(table).set({ [assignable.column]: userId } as never).where(and(eq(table.id, entityId)));
  await recordAuditTrail(db, {
    entityType: config.module === "ncr" ? "NCR" : "CAPA",
    entityId,
    action: "update",
    changes: { message: "Assignment updated by workflow action", userId, workflowNode: node.id },
    performedBy: context.__performedBy as number | undefined,
  });
  recordActionRun(context, "assign_user", { module: config.module, entityId, userId });
});

registerActionHandler("ai_suggestion", async (node, context, dryRun) => {
  if (dryRun) {
    recordActionRun(context, "ai_suggestion", { simulated: true, note: "would call the AI pipeline — skipped in simulation to avoid spending real usage quota" });
    return;
  }
  const db = context.__db as Db | undefined;
  if (!db) {
    recordActionRun(context, "ai_suggestion", { skipped: true, reason: "no database context available" });
    return;
  }

  const input = cleanContext(context);
  const { suggestion, output } = await runPipelineAndRecord(db, context.__performedBy as number | undefined, "workflow", "workflow_ai_note", input, "AI-generated workflow note", (opts) =>
    runWorkflowAiNotePipeline(input, opts)
  );
  recordActionRun(context, "ai_suggestion", { suggestionId: suggestion.id, output });
});

// Integration node: hand the tenant's configured ERP sync a nudge — the same
// triggerErpSync() the "Trigger Sync Now" button calls, so it obeys the tenant's
// own webhook, enabled modules, presets and error log. Reports "skipped" (not
// "sent") when no webhook is configured, exactly as the button does.
registerActionHandler("erp_sync", async (_node, context, dryRun) => {
  if (dryRun) {
    recordActionRun(context, "erp_sync", { simulated: true, note: "would trigger the configured ERP sync" });
    return;
  }
  const db = context.__db as Db | undefined;
  if (!db) {
    recordActionRun(context, "erp_sync", { skipped: true, reason: "no database context available" });
    return;
  }
  const result = await triggerErpSync(db, context.__performedBy as number | undefined);
  recordActionRun(context, "erp_sync", { status: result.status, message: result.message });
});
