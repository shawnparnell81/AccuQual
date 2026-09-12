import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { workflowDefinitions, workflowRuns } from "../../drizzle/schema/workflow.js";
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
