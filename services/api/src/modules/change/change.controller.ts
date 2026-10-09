import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { changeRequests } from "../../drizzle/schema/change.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { CHANGE_NUMBER } from "../records/recordNumberSpecs.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { fileOnFirstSave } from "../document-folders/defaultFormFiling.js";

export const baseHandlers = crudFactory(changeRequests, { entityName: "Change request", idColumn: "id", recordNumber: CHANGE_NUMBER, blankCreatePath: "/change" });

// Previously had no audit trail entry and published no event — the one
// hand-rolled action on this module, unlike create/update above (which get
// both for free from crudFactory). Full-System Audit finding C1.
/** Header Save with no field change still files the copy once. */
export const saveChangeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [before] = await req.db!.select().from(changeRequests).where(eq(changeRequests.id, id));
  if (!before) throw AppError.notFound("Change request");
  const [updated] = await req.db!.update(changeRequests).set({ updatedAt: new Date() }).where(eq(changeRequests.id, id)).returning();
  if (!updated) throw AppError.notFound("Change request");
  await fileOnFirstSave(req.db!, "/change", before, updated as Record<string, unknown>, { saved: true }, req.user?.id);
  res.json(updated);
});

export const approveHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [before] = await req.db!.select().from(changeRequests).where(eq(changeRequests.id, id));
  if (!before) throw AppError.notFound("Change request");
  const [updated] = await req
    .db!.update(changeRequests)
    .set({ status: "approved", approvedBy: req.user?.id, approvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(changeRequests.id, id)))
    .returning();
  if (!updated) throw AppError.notFound("Change request");
  await fileOnFirstSave(req.db!, "/change", before, updated as Record<string, unknown>, { status: "approved" }, req.user?.id);
  await recordAuditTrail(req.db!, {
    entityType: "Change request",
    entityId: updated.id,
    action: "status_change",
    changes: { action: "approve", status: "approved" },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "change", event: "approved", entityId: updated.id });
  res.json(updated);
});
