import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { documentChangeRequests, documentChangeItems, documentChangeReviews } from "../../drizzle/schema/documentChangeRequests.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { keptRevision, templateRevisionFor } from "../forms/templateRevision.js";
import { deleteRecord } from "../records/recordDeletion.js";
import { requireSignatureStamp } from "../signatures/signaturePin.service.js";
import { assignSignatureRequired, signatureBlocksFor } from "../signatures/signatureRequired.js";

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
  const revision = templateRevisionFor("dcr").revision;
  const [created] = await req.db!.insert(documentChangeRequests).values({ ...req.body, revision, createdBy: req.user?.id }).returning();
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
  const body = { ...(req.body as Record<string, unknown>) };
  delete body.revision;
  // SIGN cells are written only by the PIN endpoint.
  delete body.requesterApprovalSignature;
  delete body.requesterApprovalDate;
  delete body.vpApprovalSignature;
  delete body.vpApprovalDate;
  await assignSignatureRequired(req.db!, {
    entityType: "DocumentChangeRequest",
    entityId: record.id,
    performedBy: req.user?.id,
    previous: record,
    body,
    blocks: signatureBlocksFor("dcr"),
  });
  const revision = keptRevision(record.revision, templateRevisionFor("dcr").revision);
  const [updated] = await req.db!.update(documentChangeRequests).set({ ...body, revision, updatedAt: new Date() }).where(eq(documentChangeRequests.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "DocumentChangeRequest", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

const DCR_SIGNOFF = {
  requester: {
    column: "requesterApprovalSignature",
    date: "requesterApprovalDate",
    description: "I certify that I request this document change and the information above is accurate.",
  },
  vpEngineering: {
    column: "vpApprovalSignature",
    date: "vpApprovalDate",
    description: "I certify that I approve this document change as VP of Engineering and Quality Assurance.",
  },
} as const;

export const signDcrHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadDcr(req, Number(req.params.id));
  const field = req.body.field as keyof typeof DCR_SIGNOFF;
  const spec = DCR_SIGNOFF[field];
  const stamp = await requireSignatureStamp(req, {
    pin: req.body.pin,
    certified: req.body.certified,
    entityType: "DocumentChangeRequest",
    entityId: record.id,
    field: spec.column,
    description: spec.description,
  });
  const [updated] = await req
    .db!.update(documentChangeRequests)
    .set({ [spec.column]: stamp.stamp, [spec.date]: stamp.signedAt, updatedAt: new Date() })
    .where(eq(documentChangeRequests.id, record.id))
    .returning();
  res.json(updated);
});

export const deleteDcrHandler = asyncHandler(async (req: Request, res: Response) => {
  await deleteRecord(req, "dcr");
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
