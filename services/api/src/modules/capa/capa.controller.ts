import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { capa } from "../../drizzle/schema/capa.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

export const baseHandlers = crudFactory(capa, { entityName: "CAPA", idColumn: "id" });

export const verifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [updated] = await req
    .db!.update(capa)
    .set({ verification: req.body.verification, status: "verifying", verifiedBy: req.user?.id, verifiedAt: new Date() })
    .where(and(eq(capa.id, id), eq(capa.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("CAPA");
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "capa", entityId: id, action: "status_change", changes: { action: "verify" }, performedBy: req.user?.id });
  res.json(updated);
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [updated] = await req
    .db!.update(capa)
    .set({ status: "closed", closedAt: new Date() })
    .where(and(eq(capa.id, id), eq(capa.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("CAPA");
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "capa", entityId: id, action: "status_change", changes: { action: "close" }, performedBy: req.user?.id });
  res.json(updated);
});
