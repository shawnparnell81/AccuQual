import { Router, type Request, type Response } from "express";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { requireAuth } from "../../middleware/auth.js";
import { validate } from "../../middleware/validate.js";
import { withDb, type Db } from "../../lib/requestDb.js";
import { workflowDefinitions, workflowRuns, type WorkflowRun } from "../../drizzle/schema/workflow.js";
import { controlledVersions } from "../../drizzle/schema/versioning.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { resumeWorkflow, WorkflowNodeError, type WorkflowDefinition, type WorkflowRunState } from "./workflow-engine.js";
import { isFullAccessRole, isReviewerRole } from "../roles/roleAccess.js";
import { permissionRoles, userPermissionRoles } from "../../drizzle/schema/permissions.js";
import { CSA_WORKFLOW_KEY, prepareCsaDecision, readCsa, userMatchesAssignees, writeCsa } from "../csa-fai/csaFai.logic.js";
import { persistCsa } from "../csa-fai/csaFai.persist.js";
import { rememberCsaSla } from "../csa-fai/csaFai.service.js";

const EXECUTIVE_APPROVER_STEPS = new Set(["quality_manager", "president", "vice_president"]);

/**
 * Approval routing for workflow runs. Deliberately NOT behind the Workflow Builder's own department gate: the person
 * who has to approve a step (a production supervisor, a quality manager) is routinely someone with no access to the
 * builder at all. Who may decide is set on the approval node itself — an approver role and/or department — and checked
 * here; admins can always decide.
 */
export const workflowRunsRouter = Router();
workflowRunsRouter.use(requireAuth, withDb);

interface PendingAssignee {
  label?: string;
  roleName?: string;
}

interface PendingRoute {
  decision: string;
  label?: string;
  commentsRequired?: boolean;
}

interface PendingApproval {
  nodeId: string;
  label?: string;
  approverRole?: string;
  approverDepartment?: string;
  message?: string;
  workflowKey?: string;
  assignees?: PendingAssignee[];
  assigneeUserId?: number | string;
  routes?: PendingRoute[];
  branch?: string;
  pauseUntil?: string;
}

async function assigneeKeys(db: Db, userId: number, roleName: string | null): Promise<string[]> {
  const custom = await db
    .select({ roleName: permissionRoles.roleName })
    .from(userPermissionRoles)
    .innerJoin(permissionRoles, eq(permissionRoles.id, userPermissionRoles.roleId))
    .where(eq(userPermissionRoles.userId, userId));
  return [...(roleName ? [roleName] : []), ...custom.map((row) => row.roleName)];
}

function canDecide(user: { id: number; roleName: string | null; department: string | null }, pending: PendingApproval, keys: string[]): boolean {
  if (isFullAccessRole(user.roleName)) return true;
  const assignees = Array.isArray(pending.assignees) ? pending.assignees : [];
  if (assignees.length > 0) {
    if (pending.assigneeUserId != null && Number(pending.assigneeUserId) === user.id) return true;
    return userMatchesAssignees(keys, assignees);
  }
  if (pending.approverRole && user.roleName === pending.approverRole) return true;
  if (isReviewerRole(user.roleName) && pending.approverRole != null && EXECUTIVE_APPROVER_STEPS.has(pending.approverRole)) return true;
  if (pending.approverDepartment && user.department === pending.approverDepartment) return true;
  return false;
}

const pendingOf = (run: WorkflowRun) => (run.context as { pendingApproval?: PendingApproval } | null)?.pendingApproval;

/** Runs waiting on a decision that the signed-in user is allowed to make. */
workflowRunsRouter.get(
  "/pending-approval",
  asyncHandler(async (req: Request, res: Response) => {
    const rows = await req
      .db!.select({ run: workflowRuns, workflowName: workflowDefinitions.name })
      .from(workflowRuns)
      .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowRuns.workflowId))
      .where(and(eq(workflowRuns.status, "waiting_approval")))
      .orderBy(desc(workflowRuns.startedAt));
    const keys = await assigneeKeys(req.db!, req.user!.id, req.user!.roleName);
    res.json(
      rows
        .filter(({ run }) => {
          const pending = pendingOf(run);
          return pending && canDecide(req.user!, pending, keys);
        })
        .map(({ run, workflowName }) => ({ id: run.id, workflowId: run.workflowId, workflowName, startedAt: run.startedAt, currentNodeId: run.currentNodeId, pendingApproval: pendingOf(run) })),
    );
  }),
);

export const decisionSchema = z.object({
  decision: z.string().min(1).max(80),
  notes: z.string().max(4000).optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});

workflowRunsRouter.post(
  "/:runId/decision",
  validate(decisionSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const runId = Number(req.params.runId);
    const { decision, notes, details } = req.body as z.infer<typeof decisionSchema>;
    const [run] = await req.db!.select().from(workflowRuns).where(and(eq(workflowRuns.id, runId)));
    if (!run) throw AppError.notFound("Workflow run");
    if (run.status !== "waiting_approval" || !run.runState) throw new AppError("This run isn't waiting for an approval.", 409);

    const pending = pendingOf(run);
    const keys = await assigneeKeys(req.db!, req.user!.id, req.user!.roleName);
    if (!pending || !canDecide(req.user!, pending, keys)) throw AppError.forbidden("This approval is assigned to someone else.");
    const routes = Array.isArray(pending.routes) ? pending.routes : [];
    if (decision !== "approved" && decision !== "rejected" && !routes.some((route) => route.decision === decision)) {
      throw AppError.badRequest("That decision is not on this step.");
    }

    // Resume on the exact graph the run started with — the published version it captured — not whatever is live now.
    const [pinned] = run.definitionVersion
      ? await req
          .db!.select({ payload: controlledVersions.payload })
          .from(controlledVersions)
          .where(and(eq(controlledVersions.subjectType, "workflow"), eq(controlledVersions.subjectId, run.workflowId), eq(controlledVersions.versionNumber, run.definitionVersion)))
      : [];
    const [workflow] = await req.db!.select().from(workflowDefinitions).where(and(eq(workflowDefinitions.id, run.workflowId)));
    if (!workflow) throw AppError.notFound("Workflow");
    const graph = (pinned?.payload ?? workflow.definition) as unknown as WorkflowDefinition;

    const previous = (run.context ?? {}) as Record<string, unknown>;
    const approvals = [...((previous.approvals as unknown[]) ?? []), { node: pending.nodeId, decision, by: req.user!.id, notes: notes ?? null, at: new Date().toISOString() }];
    const context = { ...previous, approvals, __db: req.db, __performedBy: req.user!.id } as Record<string, unknown>;
    if (pending.workflowKey === CSA_WORKFLOW_KEY) {
      if (readCsa(context).locked === "Yes") throw AppError.badRequest("This CSA FAI is locked.");
      try {
        const patch = prepareCsaDecision(pending, decision, notes, details, context);
        writeCsa(context, { ...readCsa(context), ...patch });
      } catch (err) {
        throw AppError.badRequest((err as Error).message);
      }
    }

    try {
      const execution = await resumeWorkflow(graph, run.runState as WorkflowRunState, context, decision);
      if (pending.workflowKey === CSA_WORKFLOW_KEY) {
        await rememberCsaSla(req.db as Db, execution.context, execution.currentNodeId);
        await persistCsa(req.db as Db, readCsa(execution.context));
      }
      const { __db: _db, __performedBy: _performedBy, ...persistable } = execution.context;
      const waiting = execution.status === "waiting_approval";
      const [updated] = await req
        .db!.update(workflowRuns)
        .set({ status: waiting ? "waiting_approval" : "completed", context: persistable, currentNodeId: execution.currentNodeId, runState: waiting ? execution.state : null, finishedAt: waiting ? null : new Date() })
        .where(eq(workflowRuns.id, run.id))
        .returning();
      await recordAuditTrail(req.db as Db, {
        entityType: "WorkflowRun",
        entityId: run.id,
        action: "status_change",
        changes: { event: decision === "approved" ? "approval_approved" : decision === "rejected" ? "approval_rejected" : `approval_${decision}`, node: pending.nodeId, workflowId: run.workflowId, notes: notes ?? null, result: updated!.status },
        performedBy: req.user!.id,
      });
      res.json(updated);
    } catch (err) {
      await req
        .db!.update(workflowRuns)
        .set({ status: "failed", error: (err as Error).message, currentNodeId: err instanceof WorkflowNodeError ? err.nodeId : run.currentNodeId, finishedAt: new Date() })
        .where(eq(workflowRuns.id, run.id));
      throw err;
    }
  }),
);

/** One run with its step-by-step trail. */
workflowRunsRouter.get(
  "/:runId",
  asyncHandler(async (req: Request, res: Response) => {
    const [run] = await req.db!.select().from(workflowRuns).where(and(eq(workflowRuns.id, Number(req.params.runId))));
    if (!run) throw AppError.notFound("Workflow run");
    res.json(run);
  }),
);
