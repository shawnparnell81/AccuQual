import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export const baseHandlers = crudFactory(discrepancyInvestigations, { entityName: "Discrepancy investigation", idColumn: "id" });

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [current] = await req.db!.select().from(discrepancyInvestigations).where(and(eq(discrepancyInvestigations.id, id), eq(discrepancyInvestigations.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Discrepancy investigation");
  if (current.status !== "disposed") throw AppError.badRequest(`Cannot close a discrepancy investigation from status "${current.status}" — must be "disposed"`);

  const [updated] = await req
    .db!.update(discrepancyInvestigations)
    .set({ status: "closed", updatedAt: new Date() })
    .where(eq(discrepancyInvestigations.id, id))
    .returning();
  await recordAuditTrail(req.db!, {
    tenantId,
    entityType: "discrepancy_investigation",
    entityId: id,
    action: "status_change",
    changes: { action: "close" },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "di", event: "close", entityId: id });
  res.json(updated);
});
