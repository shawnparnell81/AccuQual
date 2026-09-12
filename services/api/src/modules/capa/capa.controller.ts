import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { capa } from "../../drizzle/schema/capa.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export const baseHandlers = crudFactory(capa, { entityName: "CAPA", idColumn: "id" });

export const verifyHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [current] = await req.db!.select().from(capa).where(and(eq(capa.id, id), eq(capa.tenantId, tenantId)));
  if (!current) throw AppError.notFound("CAPA");
  if (current.status !== "in_progress") throw AppError.badRequest(`Cannot verify a CAPA from status "${current.status}" — must be "in_progress"`);

  const [updated] = await req
    .db!.update(capa)
    .set({ verification: req.body.verification, status: "verifying", verifiedBy: req.user?.id, verifiedAt: new Date() })
    .where(eq(capa.id, id))
    .returning();
  await recordAuditTrail(req.db!, { tenantId, entityType: "capa", entityId: id, action: "status_change", changes: { action: "verify" }, performedBy: req.user?.id });
  // Extends the Workflow Engine trigger already used by NCR (see the Outputs
  // Dictionary's compatibility check) — same one-line pattern, new module.
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "capa", event: "verify", entityId: id });
  res.json(updated);
});

export const closeHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [current] = await req.db!.select().from(capa).where(and(eq(capa.id, id), eq(capa.tenantId, tenantId)));
  if (!current) throw AppError.notFound("CAPA");
  if (current.status !== "verifying") throw AppError.badRequest(`Cannot close a CAPA from status "${current.status}" — must be "verifying"`);

  const [updated] = await req.db!.update(capa).set({ status: "closed", closedAt: new Date() }).where(eq(capa.id, id)).returning();
  await recordAuditTrail(req.db!, { tenantId, entityType: "capa", entityId: id, action: "status_change", changes: { action: "close" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "capa", event: "close", entityId: id });
  res.json(updated);
});
