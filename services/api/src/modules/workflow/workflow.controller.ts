import type { Request, Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { workflowDefinitions, workflowRuns, type WorkflowDefinition as WorkflowDefinitionRow } from "../../drizzle/schema/workflow.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { executeWorkflow, WorkflowNodeError, getRegisteredActionKinds, type WorkflowDefinition } from "./workflow-engine.js";
import { createInitialDraft, getCurrent } from "../versioning/versioning.service.js";
import { toWorkflowPayload, workflowAdapter } from "../versioning/adapters.js";
import { recordAuditTrail, withResolvedActors, attachFieldChanges } from "../audit-trail/audit-trail.service.js";
import { RESOURCE_KEYS } from "../../middleware/departmentAccess.js";
import { WORKFLOW_TEMPLATES } from "./workflow.templates.js";
import type { TenantDb } from "../../lib/tenantScope.js";

const VERSION_HISTORY_CAP = 20;

export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await req.db!.select().from(workflowDefinitions).where(eq(workflowDefinitions.tenantId, req.tenantId!)));
});

/**
 * POST /workflow — creates the workflow AND its first draft. The workflow starts inactive: it only goes live when a
 * reviewer approves a version and it is published (see modules/versioning). The stored definition mirrors the draft so
 * the row is never empty, but nothing reads it as in force until then.
 */
export const createHandler = asyncHandler(async (req: Request, res: Response) => {
  const { name, module, definition, metadata } = req.body as { name: string; module?: string; definition?: { nodes?: never[]; edges?: never[] }; metadata?: Record<string, unknown> };
  const payload = toWorkflowPayload({ nodes: definition?.nodes, edges: definition?.edges, metadata: { ...(metadata ?? {}), name, ...(module ? { module } : {}) } });
  const [created] = await req
    .db!.insert(workflowDefinitions)
    .values({ name, module, tenantId: req.tenantId!, createdBy: req.user?.id, isActive: "false", definition: payload as unknown as Record<string, unknown>, version: 1, versionHistory: [] })
    .returning();
  if (!created) throw new AppError("Failed to create workflow", 500);
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkflowDefinition", entityId: created.id, action: "create", changes: { name, module: module ?? null }, performedBy: req.user?.id });
  const draft = await createInitialDraft(req.db as TenantDb, workflowAdapter, req.tenantId!, created.id, { id: req.user!.id, roleName: req.user!.roleName }, payload as unknown as Record<string, unknown>);
  res.status(201).json({ ...created, draftVersionId: draft.id });
});

/** GET /workflow/:id — the workflow, what is in force, and what is being worked on. */
export const getHandler = asyncHandler(async (req: Request, res: Response) => {
  const workflow = await loadDefinition(req, Number(req.params.id));
  const current = await getCurrent(req.db as TenantDb, workflowAdapter, req.tenantId!, workflow.id);
  res.json({ ...workflow, ...current });
});

async function loadDefinition(req: Request, id: number): Promise<WorkflowDefinitionRow> {
  const [row] = await req.db!.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("Workflow");
  return row;
}

/**
 * PATCH /workflow/:id — Phase 9 task 7's "versioning for workflow changes."
 * Only bumps `version`/appends to `versionHistory` when `definition` itself
 * actually changes (a rename or isActive toggle isn't a new "version" of
 * the graph) — capped at VERSION_HISTORY_CAP entries, oldest dropped first,
 * same "human-edited config, not an unbounded ledger" convention
 * erpSyncSettings.statusHistory already established.
 */
export const updateHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await loadDefinition(req, id);
  const body = req.body as { name?: string; module?: string; isActive?: string; definition?: Record<string, unknown> };

  // The graph a workflow runs is controlled: it changes only by publishing a reviewed version (POST /workflow/:id/draft, /review, /publish).
  if (body.definition !== undefined && JSON.stringify(body.definition) !== JSON.stringify(existing.definition)) {
    throw new AppError("A workflow's steps can't be changed directly any more. Start a draft, get it reviewed, and publish it.", 409);
  }
  const { definition: _ignored, ...allowed } = body;
  const patch: Record<string, unknown> = { ...allowed, updatedAt: new Date() };
  const definitionChanged = false;

  const [updated] = await req.db!.update(workflowDefinitions).set(patch).where(eq(workflowDefinitions.id, id)).returning();
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "WorkflowDefinition",
    entityId: id,
    action: "update",
    changes: { fieldsChanged: Object.keys(body), newVersion: definitionChanged ? patch.version : existing.version },
    performedBy: req.user?.id,
  });
  res.json(updated);
});

export const deleteHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const existing = await loadDefinition(req, id);
  // A workflow with published versions is a controlled record: those versions can never be deleted, so neither can it. Deactivate it instead.
  const [published] = await req.db!.select({ id: controlledVersions.id }).from(controlledVersions).where(and(eq(controlledVersions.tenantId, req.tenantId!), eq(controlledVersions.subjectType, "workflow"), eq(controlledVersions.subjectId, id), inArray(controlledVersions.status, ["published", "archived"]))).limit(1);
  if (published) throw new AppError("This workflow has published versions, which are kept for the record, so it can't be deleted. Deactivate it instead.", 409);
  await req.db!.delete(controlledVersions).where(and(eq(controlledVersions.tenantId, req.tenantId!), eq(controlledVersions.subjectType, "workflow"), eq(controlledVersions.subjectId, id)));
  await req.db!.delete(workflowRuns).where(and(eq(workflowRuns.workflowId, id), eq(workflowRuns.tenantId, req.tenantId!)));
  await req.db!.delete(workflowDefinitions).where(eq(workflowDefinitions.id, id));
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkflowDefinition", entityId: id, action: "delete", changes: { name: existing.name }, performedBy: req.user?.id });
  res.status(204).send();
});

/**
 * POST /workflow/:id/run — Phase 9 task 9's Simulation Mode: `simulate:
 * true` walks the exact same graph/condition logic (so reachability and
 * condition outcomes are genuinely exercised) but every action handler
 * skips its real side effect (see workflowActions.ts's own dryRun
 * handling). A simulated run is marked `simulated: true` on its own
 * workflowRuns row (never conflated with a real run — task 8's health
 * check explicitly excludes these) and gets its own distinct "simulation
 * only" audit entry on the WorkflowDefinition itself, never on whatever
 * real record the context happens to reference.
 *
 * Also fixes a real bug: `__db`/`__tenantId`/`__performedBy` (injected so
 * workflowActions.ts's real handlers can reach a live DB/tenant/actor — see
 * that file's own comment) are NOT JSON-serializable and must never be
 * persisted into workflowRuns.context.
 */
export const runHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const workflow = await loadDefinition(req, id);

  const { context: inputContext, simulate } = req.body as { context?: Record<string, unknown>; simulate?: boolean };
  const [run] = await req
    .db!.insert(workflowRuns)
    .values({ workflowId: id, tenantId: req.tenantId!, context: inputContext, status: "running", simulated: !!simulate, definitionVersion: workflow.version })
    .returning();
  if (!run) throw new AppError("Failed to start workflow run", 500);

  const runContext = { ...(inputContext ?? {}), __db: req.db, __tenantId: req.tenantId, __performedBy: req.user?.id };

  try {
    const execution = await executeWorkflow(workflow.definition as unknown as WorkflowDefinition, runContext, { dryRun: !!simulate });
    const { __db: _db, __tenantId: _tenantId, __performedBy: _performedBy, ...persistable } = execution.context;

    // A run that reached an approval node stays open, with its position saved, until someone decides (POST /workflow/runs/:id/decision).
    const waiting = execution.status === "waiting_approval";
    const [finished] = await req
      .db!.update(workflowRuns)
      .set({ status: waiting ? "waiting_approval" : "completed", context: persistable, currentNodeId: execution.currentNodeId, runState: waiting ? execution.state : null, finishedAt: waiting ? null : new Date() })
      .where(eq(workflowRuns.id, run.id))
      .returning();

    if (simulate) {
      await recordAuditTrail(req.db!, {
        tenantId: req.tenantId!,
        entityType: "WorkflowDefinition",
        entityId: id,
        action: "update",
        changes: { message: "Workflow simulation run (no real actions were performed)", runId: run.id, actionsWouldRun: persistable.actionsRun ?? [] },
        performedBy: req.user?.id,
      });
    }
    res.json(finished);
  } catch (err) {
    await req
      .db!.update(workflowRuns)
      .set({ status: "failed", error: (err as Error).message, currentNodeId: err instanceof WorkflowNodeError ? err.nodeId : null, finishedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));
    throw err;
  }
});

const MODULE_ENTITY_TYPES: Record<string, string> = {
  calibration: "Equipment",
  quarantine: "Quarantine",
  documents: "Document",
  training: "TrainingAssignment",
  audit: "Audit",
  ncr: "NCR",
  capa: "CAPA",
  di: "Discrepancy investigation",
  complaints: "Complaint",
  suppliers: "Supplier",
  inventory: "InventoryItem",
  erp: "PurchaseOrder",
  rma: "Rma",
  work_orders: "WorkOrder",
  risk: "RiskAssessment",
  feasibility: "FeasibilityReview",
  sales_accounts: "SalesAccount",
  customers: "Customer",
  document_change_requests: "DocumentChangeRequest",
  qms_forms: "QmsForm",
  scar_forms: "ScarForm",
  quality_inspection_reports: "QualityInspectionReport",
  // Phase 9 — added for completeness alongside this phase's own real
  // audit/event fixes to eight_d/documents; warranty/crar/rma_log already
  // had real, correctly-cased audit trails but were never added here since
  // each uses its own bespoke history panel today (not a bug — this just
  // means WorkflowHistoryPanel/GET /workflow/history/:moduleName/... now
  // works for them too, if anything ever wants it).
  eight_d: "8D Report",
  warranty: "WarrantyClaim",
  crar: "Crar",
  rma_log: "RmaLog",
};

/** GET /workflow/history/:moduleName/:recordId — read-only, backed entirely by the existing audit_trail table. */
export const historyHandler = asyncHandler(async (req: Request, res: Response) => {
  const { moduleName, recordId } = req.params as { moduleName: string; recordId: string };
  const entityType = MODULE_ENTITY_TYPES[moduleName];
  if (!entityType) throw AppError.badRequest(`Unknown moduleName "${moduleName}" — expected one of: ${Object.keys(MODULE_ENTITY_TYPES).join(", ")}`);

  const rows = await req
    .db!.select()
    .from(auditTrail)
    .where(and(eq(auditTrail.entityId, Number(recordId)), eq(auditTrail.entityType, entityType), eq(auditTrail.tenantId, req.tenantId!)));

  const sorted = [...rows].sort((a, b) => new Date(b.createdAt ?? 0).getTime() - new Date(a.createdAt ?? 0).getTime());
  const withActors = await withResolvedActors(req.db! as TenantDb, sorted);
  res.json(await attachFieldChanges(req.db! as TenantDb, req.tenantId!, withActors));
});

/** GET /workflow/templates — Phase 9 task 6's starter templates (real, static graphs mirroring each module's own real states/events — see workflow.templates.ts). Loading one into the builder still requires an explicit Save; nothing here has any side effect. */
export const templatesHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(WORKFLOW_TEMPLATES);
});

/** GET /workflow/action-kinds — the real, currently-registered action kinds (see workflowActions.ts) — what the builder UI's action dropdown should actually offer, instead of a hardcoded list that can silently drift from what the engine can actually execute. */
export const actionKindsHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(getRegisteredActionKinds());
});

interface DefinitionHealth {
  id: number;
  name: string;
  module: string | null;
  isActive: boolean;
  version: number;
  lastSuccessfulRunAt: string | null;
  lastFailedRunAt: string | null;
  lastFailedRunError: string | null;
  issues: string[];
}

/**
 * GET /workflow/health — Phase 9 task 8, genuinely new (confirmed absent
 * anywhere in the app before this phase). Per-definition: last successful
 * / last failed REAL run (simulated runs excluded — a simulation succeeding
 * or failing says nothing about the live system), plus real structural
 * diagnostics: an action node whose kind has no registered handler
 * (workflow-engine.ts's registry is the single source of truth for what's
 * actually executable), and a `module` that doesn't match any real
 * ResourceKey (a definition that can never usefully gate/relate to
 * anything — "missing permissions" in the sense that no department
 * permission concept even applies to it).
 */
/**
 * Shared by GET /workflow/health above and the Admin Console's consolidated
 * GET /system-health (Phase 10) — extracted so "workflow health" has exactly
 * one real implementation instead of the system-health summary silently
 * drifting from what this page itself reports.
 */
export async function buildWorkflowHealthReport(db: TenantDb, tenantId: number) {
  const definitions = await db.select().from(workflowDefinitions).where(eq(workflowDefinitions.tenantId, tenantId));
  const registeredKinds = new Set(getRegisteredActionKinds());
  const knownModules = new Set(RESOURCE_KEYS as string[]);

  const results: DefinitionHealth[] = [];
  for (const def of definitions) {
    const runs = await db.select().from(workflowRuns).where(and(eq(workflowRuns.workflowId, def.id), eq(workflowRuns.tenantId, tenantId), eq(workflowRuns.simulated, false)));
    const completed = runs.filter((r) => r.status === "completed").sort((a, b) => new Date(b.finishedAt ?? 0).getTime() - new Date(a.finishedAt ?? 0).getTime());
    const failed = runs.filter((r) => r.status === "failed").sort((a, b) => new Date(b.finishedAt ?? 0).getTime() - new Date(a.finishedAt ?? 0).getTime());

    const issues: string[] = [];
    const graph = def.definition as unknown as WorkflowDefinition;
    for (const node of graph?.nodes ?? []) {
      if (node.type === "action" && !registeredKinds.has(node.kind)) issues.push(`Action node "${node.id}" uses unregistered action kind "${node.kind}"`);
    }
    if (def.module && !knownModules.has(def.module)) issues.push(`Module "${def.module}" doesn't match any real permission module — this workflow can never be scoped to a department`);
    if (!graph?.nodes?.some((n) => n.type === "trigger")) issues.push("No trigger node — this workflow can never run from a real event");

    results.push({
      id: def.id,
      name: def.name,
      module: def.module,
      isActive: def.isActive === "true",
      version: def.version,
      lastSuccessfulRunAt: completed[0]?.finishedAt ? new Date(completed[0].finishedAt).toISOString() : null,
      lastFailedRunAt: failed[0]?.finishedAt ? new Date(failed[0].finishedAt).toISOString() : null,
      lastFailedRunError: failed[0]?.error ?? null,
      issues,
    });
  }

  return {
    definitions: results,
    summary: {
      total: results.length,
      active: results.filter((r) => r.isActive).length,
      withIssues: results.filter((r) => r.issues.length > 0).length,
      neverRun: results.filter((r) => !r.lastSuccessfulRunAt && !r.lastFailedRunAt).length,
    },
  };
}

export const healthHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await buildWorkflowHealthReport(req.db! as TenantDb, req.tenantId!));
});
