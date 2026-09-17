import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { capa } from "../../drizzle/schema/capa.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export const baseHandlers = crudFactory(capa, { entityName: "CAPA", idColumn: "id" });

/** GET /capa — Phase 8 adds an optional `?supplierId=` filter (same reasoning as ncr.controller.ts's own listHandler) for the receiving → CAPA traceability chain; falls through to baseHandlers.list's plain query when omitted. */
export const listHandler = asyncHandler(async (req: Request, res: Response) => {
  const { supplierId } = req.query as Record<string, string | undefined>;
  if (!supplierId) return baseHandlers.list(req, res, () => undefined);
  const rows = await req.db!.select().from(capa).where(and(eq(capa.tenantId, req.tenantId!), eq(capa.supplierId, Number(supplierId))));
  res.json(rows);
});

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
  // "CAPA" — must match crudFactory's entityName above exactly; see the QA
  // sweep review on why a casing mismatch here made this history invisible.
  await recordAuditTrail(req.db!, { tenantId, entityType: "CAPA", entityId: id, action: "status_change", changes: { action: "verify" }, performedBy: req.user?.id });
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
  await recordAuditTrail(req.db!, { tenantId, entityType: "CAPA", entityId: id, action: "status_change", changes: { action: "close" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "capa", event: "close", entityId: id });
  res.json(updated);
});
