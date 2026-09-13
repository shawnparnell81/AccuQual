import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { workflowDefinitions, workflowRuns } from "../../drizzle/schema/workflow.js";
import { auditTrail } from "../../drizzle/schema/auditTrail.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { runWorkflow, type WorkflowDefinition } from "./workflow-engine.js";

export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await req.db!.select().from(workflowDefinitions).where(eq(workflowDefinitions.tenantId, req.tenantId!)));
});

export const createHandler = asyncHandler(async (req: Request, res: Response) => {
  const [created] = await req
    .db!.insert(workflowDefinitions)
    .values({ ...req.body, tenantId: req.tenantId!, createdBy: req.user?.id })
    .returning();
  res.status(201).json(created);
});

export const runHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [workflow] = await req
    .db!.select()
    .from(workflowDefinitions)
    .where(and(eq(workflowDefinitions.id, id), eq(workflowDefinitions.tenantId, req.tenantId!)));
  if (!workflow) throw AppError.notFound("Workflow");

  const [run] = await req
    .db!.insert(workflowRuns)
    .values({ workflowId: id, tenantId: req.tenantId!, context: req.body.context, status: "running" })
    .returning();
  if (!run) throw new AppError("Failed to start workflow run", 500);

  try {
    const result = await runWorkflow(workflow.definition as unknown as WorkflowDefinition, req.body.context ?? {});
    const [finished] = await req
      .db!.update(workflowRuns)
      .set({ status: "completed", context: result, finishedAt: new Date() })
      .where(eq(workflowRuns.id, run.id))
      .returning();
    res.json(finished);
  } catch (err) {
    await req
      .db!.update(workflowRuns)
      .set({ status: "failed", error: (err as Error).message, finishedAt: new Date() })
      .where(eq(workflowRuns.id, run.id));
    throw err;
  }
});

/**
 * Friendly moduleName -> the real entityType string each module actually
 * passes to recordAuditTrail (see every controller's recordAuditTrail
 * calls). Deliberately NOT a generic "any module, any state" endpoint (see
 * Phase 6's notes) — audit_trail already has everything a transition
 * history needs, this just gives every module one predictable read shape
 * instead of the caller having to know each module's internal entityType
 * naming (some PascalCase, some lowercase — a pre-existing inconsistency).
 */
const MODULE_ENTITY_TYPES: Record<string, string> = {
  calibration: "Equipment",
  documents: "Document",
  training: "TrainingAssignment",
  audit: "Audit",
  ncr: "ncr",
  capa: "capa",
  di: "discrepancy_investigation",
  suppliers: "Supplier",
  inventory: "InventoryItem",
  erp: "PurchaseOrder",
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
  res.json(sorted);
});
