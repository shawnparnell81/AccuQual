import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { feasibilityReviews, feasibilityScores } from "../../drizzle/schema/feasibility.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { stripClientOwnedFields } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

/** Same inline-guard style as risk/workOrders/erp/rma.controller.ts's assertDepartment. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

/**
 * Delete is a deliberate widening from risk.controller.ts's admin-only rule
 * — this module's own spec explicitly lists delete under BOTH Quality's
 * capabilities ("can create, edit, submit, review, approve, reject, delete
 * within role limits") and Admin's, so quality department OR tenant
 * admin/platform_admin can delete here, not admin alone.
 */
function assertDeleteAllowed(req: Request) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  if (req.user?.department === "quality") return;
  throw AppError.forbidden("Only Quality or an admin can delete a feasibility review.");
}

/**
 * overallScore: "sum of (value * weight) across all dimensions, OR average
 * of values if weight is null" — read as a record-level choice (every score
 * either all carries a real weight, or none does) rather than a per-row
 * fallback, since a mix of weighted and unweighted rows in the same average
 * has no well-defined meaning. If EVERY score has a non-null weight, this is
 * a weighted sum; otherwise a plain average of values. Documented here since
 * the spec asked for the chosen formula to be explicit.
 */
export function computeOverallScore(scores: { value: string | number; weight: string | number | null }[]): number | null {
  if (scores.length === 0) return null;
  const allWeighted = scores.every((s) => s.weight !== null && s.weight !== undefined);
  if (allWeighted) {
    return scores.reduce((sum, s) => sum + Number(s.value) * Number(s.weight), 0);
  }
  return scores.reduce((sum, s) => sum + Number(s.value), 0) / scores.length;
}

/**
 * Decision thresholds — locked in per the module spec, on the same 1-5 scale
 * every dimension value uses. Named constants, documented here as required.
 */
export const FEASIBLE_MIN = 3.5;
export const CONDITIONAL_MIN = 2.5;

export function computeDecision(overallScore: number | null): string | null {
  if (overallScore === null) return null;
  if (overallScore >= FEASIBLE_MIN) return "feasible";
  if (overallScore >= CONDITIONAL_MIN) return "conditional";
  return "not_feasible";
}

async function loadFeasibility(req: Request, id: number) {
  const [row] = await req.db!.select().from(feasibilityReviews).where(and(eq(feasibilityReviews.id, id), eq(feasibilityReviews.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("Feasibility review");
  return row;
}

/** Recomputes overallScore/decision from every real score row and writes both back — called after any score add/update. */
async function recalcScoring(req: Request, feasibilityId: number) {
  const scores = await req.db!.select().from(feasibilityScores).where(and(eq(feasibilityScores.feasibilityId, feasibilityId), eq(feasibilityScores.tenantId, req.tenantId!)));
  const overallScore = computeOverallScore(scores);
  const decision = computeDecision(overallScore);
  await req
    .db!.update(feasibilityReviews)
    .set({ overallScore: overallScore === null ? null : String(overallScore), decision, updatedAt: new Date() })
    .where(eq(feasibilityReviews.id, feasibilityId));
  return { overallScore, decision };
}

const ALLOWED_NEXT: Record<string, string[]> = {
  draft: ["submitted"],
  submitted: ["under_review"],
  under_review: ["approved", "rejected"],
  approved: [],
  rejected: [],
};

async function transition(req: Request, id: number, newStatus: string) {
  const record = await loadFeasibility(req, id);
  if (!ALLOWED_NEXT[record.status]?.includes(newStatus)) {
    throw AppError.badRequest(`Cannot move a feasibility review from "${record.status}" to "${newStatus}" — workflow is draft -> submitted -> under_review -> approved|rejected.`);
  }
  const isDecision = newStatus === "approved" || newStatus === "rejected";
  const [updated] = await req
    .db!.update(feasibilityReviews)
    .set({
      status: newStatus,
      updatedAt: new Date(),
      ...(isDecision ? { decidedAt: new Date(), reviewerId: req.user?.id ?? record.reviewerId } : {}),
    })
    .where(eq(feasibilityReviews.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "FeasibilityReview",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId: req.tenantId!, module: "feasibility", event: newStatus, entityId: record.id });
  return updated!;
}

export const listFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, sourceType, department } = req.query as Record<string, string | undefined>;
  const conditions = [eq(feasibilityReviews.tenantId, req.tenantId!)];
  if (status) conditions.push(eq(feasibilityReviews.status, status));
  if (sourceType) conditions.push(eq(feasibilityReviews.sourceType, sourceType));
  if (department) conditions.push(eq(feasibilityReviews.department, department));

  const rows = await req.db!.select().from(feasibilityReviews).where(and(...conditions)).orderBy(desc(feasibilityReviews.createdAt));
  res.json(rows);
});

/** Create — any of the shared floor's five departments, matching risk.controller.ts's createRiskHandler exactly. */
export const createFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering", "production", "purchasing", "material_management"]);
  const [created] = await req
    .db!.insert(feasibilityReviews)
    .values({ ...req.body, tenantId: req.tenantId!, createdBy: req.user?.id })
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "FeasibilityReview", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadFeasibility(req, Number(req.params.id));
  const scores = await req.db!.select().from(feasibilityScores).where(and(eq(feasibilityScores.feasibilityId, record.id), eq(feasibilityScores.tenantId, req.tenantId!)));
  res.json({ ...record, scores });
});

/** Update — quality + engineering only (mirroring risk's updateRiskHandler); production/purchasing/material_management can still add/update scores below. */
export const updateFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering"]);
  const record = await loadFeasibility(req, Number(req.params.id));
  const { aiSuggested, ...rest } = req.body as { aiSuggested?: boolean } & Record<string, unknown>;
  const body = stripClientOwnedFields(rest);

  const [updated] = await req
    .db!.update(feasibilityReviews)
    .set({ ...body, updatedAt: new Date() })
    .where(eq(feasibilityReviews.id, record.id))
    .returning();

  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "FeasibilityReview",
    entityId: record.id,
    action: "update",
    changes: aiSuggested ? { subAction: "ai_suggestion_accepted", fieldsChanged: Object.keys(body), ...body } : { fieldsChanged: Object.keys(body), ...body },
    performedBy: req.user?.id,
  });
  res.json(updated);
});

/** draft -> submitted. Quality only ("full control" of the workflow per the spec). */
export const submitFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality"]);
  res.json(await transition(req, Number(req.params.id), "submitted"));
});

/** submitted -> under_review. Quality only. */
export const reviewFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality"]);
  res.json(await transition(req, Number(req.params.id), "under_review"));
});

/** under_review -> approved. Quality only. */
export const approveFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality"]);
  res.json(await transition(req, Number(req.params.id), "approved"));
});

/** under_review -> rejected. Quality only. */
export const rejectFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality"]);
  res.json(await transition(req, Number(req.params.id), "rejected"));
});

/** Delete — quality department OR admin/platform_admin (see assertDeleteAllowed's own comment on why this differs from risk's admin-only rule). Hard delete; scores deleted first for the FK. */
export const deleteFeasibilityHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDeleteAllowed(req);
  const record = await loadFeasibility(req, Number(req.params.id));

  await req.db!.delete(feasibilityScores).where(and(eq(feasibilityScores.feasibilityId, record.id), eq(feasibilityScores.tenantId, req.tenantId!)));
  await req.db!.delete(feasibilityReviews).where(and(eq(feasibilityReviews.id, record.id), eq(feasibilityReviews.tenantId, req.tenantId!)));

  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "FeasibilityReview", entityId: record.id, action: "delete", changes: { title: record.title, status: record.status }, performedBy: req.user?.id });
  res.status(204).send();
});

/** Add a scoring dimension — any of the shared floor's five departments (each department scores the dimensions relevant to it; the record owner/Quality doesn't have to enter every number themselves). */
export const addScoreHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering", "production", "purchasing", "material_management"]);
  const review = await loadFeasibility(req, Number(req.params.id));
  const { aiSuggested, ...body } = req.body as { aiSuggested?: boolean; dimensionKey: string; dimensionLabel?: string; dimensionType?: string; value: number; weight?: number };

  const [created] = await req
    .db!.insert(feasibilityScores)
    .values({
      ...body,
      value: String(body.value),
      weight: body.weight !== undefined ? String(body.weight) : undefined,
      contribution: body.weight !== undefined ? String(body.value * body.weight) : null,
      feasibilityId: review.id,
      tenantId: req.tenantId!,
      createdBy: req.user?.id,
    })
    .returning();
  const { overallScore, decision } = await recalcScoring(req, review.id);

  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "FeasibilityReview",
    entityId: review.id,
    action: "update",
    changes: aiSuggested
      ? { subAction: "ai_suggestion_accepted", scoreAction: "score_added", ...body, newOverallScore: overallScore, newDecision: decision }
      : { subAction: "score_added", ...body, newOverallScore: overallScore, newDecision: decision },
    performedBy: req.user?.id,
  });
  res.status(201).json(created);
});

export const updateScoreHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["quality", "engineering", "production", "purchasing", "material_management"]);
  const reviewId = Number(req.params.id);
  const scoreId = Number(req.params.sid);
  const [existing] = await req.db!.select().from(feasibilityScores).where(and(eq(feasibilityScores.id, scoreId), eq(feasibilityScores.feasibilityId, reviewId), eq(feasibilityScores.tenantId, req.tenantId!)));
  if (!existing) throw AppError.notFound("Feasibility score");

  const body = stripClientOwnedFields(req.body) as { value?: number; weight?: number | null; dimensionLabel?: string };
  const nextValue = body.value ?? Number(existing.value);
  const nextWeight = body.weight !== undefined ? body.weight : existing.weight;

  const [updated] = await req
    .db!.update(feasibilityScores)
    .set({
      ...body,
      value: body.value !== undefined ? String(body.value) : undefined,
      weight: body.weight !== undefined ? (body.weight === null ? null : String(body.weight)) : undefined,
      contribution: nextWeight !== null && nextWeight !== undefined ? String(nextValue * Number(nextWeight)) : null,
      updatedAt: new Date(),
    })
    .where(eq(feasibilityScores.id, scoreId))
    .returning();
  const { overallScore, decision } = await recalcScoring(req, reviewId);

  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "FeasibilityReview",
    entityId: reviewId,
    action: "update",
    changes: { subAction: "score_updated", scoreId, ...body, newOverallScore: overallScore, newDecision: decision },
    performedBy: req.user?.id,
  });
  res.json(updated);
});
