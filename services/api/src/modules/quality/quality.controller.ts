import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { discrepancyInvestigations } from "../../drizzle/schema/quality.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

export const baseHandlers = crudFactory(discrepancyInvestigations, { entityName: "Discrepancy investigation", idColumn: "id" });

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [updated] = await req
    .db!.update(discrepancyInvestigations)
    .set({ status: "closed", updatedAt: new Date() })
    .where(and(eq(discrepancyInvestigations.id, id), eq(discrepancyInvestigations.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("Discrepancy investigation");
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "discrepancy_investigation",
    entityId: id,
    action: "status_change",
    changes: { action: "close" },
    performedBy: req.user?.id,
  });
  res.json(updated);
});
