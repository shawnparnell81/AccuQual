import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { documentChangeRequests, documentChangeItems, documentChangeReviews } from "../../drizzle/schema/documentChangeRequests.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

async function loadDcr(req: Request, id: number) {
  const [row] = await req.db!.select().from(documentChangeRequests).where(and(eq(documentChangeRequests.id, id)));
  if (!row) throw AppError.notFound("Document Change Request");
  return row;
}

export const listDcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (status) conditions.push(eq(documentChangeRequests.status, status));
  const rows = await req.db!.select().from(documentChangeRequests).where(and(...conditions)).orderBy(desc(documentChangeRequests.createdAt));
  res.json(rows);
});

export const createDcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const [created] = await req.db!.insert(documentChangeRequests).values({ ...req.body, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getDcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const items = await req.db!.select().from(documentChangeItems).where(and(eq(documentChangeItems.documentChangeRequestId, record.id))).orderBy(documentChangeItems.id);
  const reviews = await req.db!.select().from(documentChangeReviews).where(and(eq(documentChangeReviews.documentChangeRequestId, record.id))).orderBy(documentChangeReviews.id);
  res.json({ ...record, items, reviews });
});

export const updateDcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const [updated] = await req.db!.update(documentChangeRequests).set({ ...req.body, updatedAt: new Date() }).where(eq(documentChangeRequests.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteDcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  await req.db!.delete(documentChangeItems).where(and(eq(documentChangeItems.documentChangeRequestId, record.id)));
  await req.db!.delete(documentChangeReviews).where(and(eq(documentChangeReviews.documentChangeRequestId, record.id)));
  await req.db!.delete(documentChangeRequests).where(and(eq(documentChangeRequests.id, record.id)));
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "delete", changes: { formNo: record.formNo }, performedBy: req.user?.id });
  res.status(204).send();
});

// ---- Change Request items (the mockup's repeatable "Change Request" table) ----

async function loadItem(req: Request, dcrId: number, itemId: number) {
  const [row] = await req.db!.select().from(documentChangeItems).where(and(eq(documentChangeItems.id, itemId), eq(documentChangeItems.documentChangeRequestId, dcrId)));
  if (!row) throw AppError.notFound("Change item");
  return row;
}

export const createChangeItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const [created] = await req.db!.insert(documentChangeItems).values({ ...req.body, documentChangeRequestId: record.id, }).returning();
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: { subAction: "change_item_added", ...req.body }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateChangeItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const item = await loadItem(req, record.id, Number(req.params.itemId));
  const [updated] = await req.db!.update(documentChangeItems).set({ ...req.body, updatedAt: new Date() }).where(eq(documentChangeItems.id, item.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: { subAction: "change_item_updated", itemId: item.id, ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteChangeItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const item = await loadItem(req, record.id, Number(req.params.itemId));
  await req.db!.delete(documentChangeItems).where(eq(documentChangeItems.id, item.id));
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: { subAction: "change_item_removed", itemId: item.id }, performedBy: req.user?.id });
  res.status(204).send();
});

// ---- Review & Approval rows (the mockup's repeatable "Review & Approval" table) ----

async function loadReview(req: Request, dcrId: number, reviewId: number) {
  const [row] = await req.db!.select().from(documentChangeReviews).where(and(eq(documentChangeReviews.id, reviewId), eq(documentChangeReviews.documentChangeRequestId, dcrId)));
  if (!row) throw AppError.notFound("Review");
  return row;
}

export const createReviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const [created] = await req.db!.insert(documentChangeReviews).values({ ...req.body, documentChangeRequestId: record.id, }).returning();
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: { subAction: "review_added", ...req.body }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateReviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const review = await loadReview(req, record.id, Number(req.params.reviewId));
  const { decision, ...rest } = req.body as { decision?: string | null } & Record<string, unknown>;
  const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  // reviewDate is always server-stamped the moment decision is first set — never client-supplied (same reasoning as Work Order's operation signOffDate).
  if (decision !== undefined) {
    patch.decision = decision;
    patch.reviewDate = decision && !review.decision ? new Date() : decision ? review.reviewDate : null;
  }
  const [updated] = await req.db!.update(documentChangeReviews).set(patch).where(eq(documentChangeReviews.id, review.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: { subAction: "review_updated", reviewId: review.id, ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteReviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const review = await loadReview(req, record.id, Number(req.params.reviewId));
  await req.db!.delete(documentChangeReviews).where(eq(documentChangeReviews.id, review.id));
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: { subAction: "review_removed", reviewId: review.id }, performedBy: req.user?.id });
  res.status(204).send();
});
