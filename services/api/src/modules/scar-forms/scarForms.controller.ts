import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { scarForms } from "../../drizzle/schema/scarForms.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

async function loadScar(req: Request, id: number) {
  const [row] = await req.db!.select().from(scarForms).where(and(eq(scarForms.id, id)));
  if (!row) throw AppError.notFound("SCAR");
  return row;
}

export const listScarFormsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status, supplierId } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (status) conditions.push(eq(scarForms.status, status));
  if (supplierId) conditions.push(eq(scarForms.supplierId, Number(supplierId)));
  const rows = await req.db!.select().from(scarForms).where(and(...conditions)).orderBy(desc(scarForms.createdAt));
  res.json(rows);
});

export const createScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const [created] = await req.db!.insert(scarForms).values({ ...req.body, createdBy: req.user?.id }).returning();
  await recordAuditTrail(req.db!, { entityType: "ScarForm", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  // Full-System Audit finding M1 — same publishEvent(WORKFLOW_STREAM, ...)
  // shape CAPA/CRAR/RMA already emit on their own create/status changes;
  // SCAR had none at all, so a workflow definition reacting to "scar"
  // events (or the record's own History tab's live updates) never saw one.
  await publishEvent(WORKFLOW_STREAM, { module: "scar", event: "create", entityId: created!.id });
  res.status(201).json(created);
});

export const getScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  res.json(await loadScar(req, Number(req.params.id)));
});

export const updateScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadScar(req, Number(req.params.id));
  const [updated] = await req.db!.update(scarForms).set({ ...req.body, updatedAt: new Date() }).where(eq(scarForms.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "ScarForm", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  // SCAR has no dedicated /close endpoint (unlike CAPA/CRAR/RMA) — closing
  // one is just a PATCH that sets status:"closed" among its other fields.
  // Same event-naming convention CRAR/RMA already use for their own status
  // changes: the new status when it actually changed, a plain "update"
  // otherwise, so a real close is distinguishable from an ordinary field
  // edit on the same "scar" workflow stream.
  const event = updated!.status !== record.status ? updated!.status : "update";
  await publishEvent(WORKFLOW_STREAM, { module: "scar", event, entityId: record.id });
  res.json(updated);
});

export const deleteScarFormHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadScar(req, Number(req.params.id));
  await req.db!.delete(scarForms).where(and(eq(scarForms.id, record.id)));
  await recordAuditTrail(req.db!, { entityType: "ScarForm", entityId: record.id, action: "delete", changes: { scarNumber: record.scarNumber }, performedBy: req.user?.id });
  res.status(204).send();
});
