import type { Request, Response } from "express";
import { and, eq } from "drizzle-orm";
import { suppliers, supplierScorecards } from "../../drizzle/schema/supplier.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export const baseHandlers = crudFactory(suppliers, { entityName: "Supplier", idColumn: "id" });

export const addScorecardHandler = asyncHandler(async (req: Request, res: Response) => {
  const supplierId = Number(req.params.id);
  const [supplier] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, supplierId), eq(suppliers.tenantId, req.tenantId!)));
  if (!supplier) throw AppError.notFound("Supplier");

  const { qualityScore = 0, deliveryScore = 0 } = req.body;
  const overallScore = (Number(qualityScore) + Number(deliveryScore)) / 2;

  const [scorecard] = await req
    .db!.insert(supplierScorecards)
    .values({ ...req.body, supplierId, tenantId: req.tenantId!, overallScore: String(overallScore) })
    .returning();
  res.status(201).json(scorecard);
});

/**
 * Real dedicated status-change actions for a module that previously had none
 * (see the Transitions/Rules/Outputs Dictionaries: every supplier status
 * change went through the generic PATCH, with no curated audit entry and no
 * Workflow Engine trigger). "disqualified" is treated as terminal — none of
 * the other three actions can move a supplier back out of it; only a plain
 * PATCH (or a future dedicated "reinstate" action) could, deliberately.
 */
async function setSupplierStatus(req: Request, res: Response, action: string, newStatus: string) {
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [current] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Supplier");
  if (current.status === "disqualified") throw AppError.badRequest(`Cannot "${action}" a disqualified supplier — disqualification is terminal`);

  const [updated] = await req.db!.update(suppliers).set({ status: newStatus }).where(eq(suppliers.id, id)).returning();

  await recordAuditTrail(req.db!, { tenantId, entityType: "Supplier", entityId: id, action: "status_change", changes: { action, from: current.status, to: newStatus }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "supplier", event: action, entityId: id });

  res.json(updated);
}

export const approveHandler = asyncHandler((req: Request, res: Response) => setSupplierStatus(req, res, "approve", "active"));
export const conditionalHandler = asyncHandler((req: Request, res: Response) => setSupplierStatus(req, res, "conditional", "probation"));
// "suspended" is a new value, not yet in the schema comment's enum list —
// safe to introduce because `status` is a plain text column, not a DB enum.
export const suspendHandler = asyncHandler((req: Request, res: Response) => setSupplierStatus(req, res, "suspend", "suspended"));
export const removeHandler = asyncHandler(async (req: Request, res: Response) => {
  // Disqualification is the one status change allowed to run even from
  // "disqualified" itself (idempotent) — it's the terminal state, not
  // something to be blocked from re-affirming.
  const id = Number(req.params.id);
  const tenantId = req.tenantId!;
  const [current] = await req.db!.select().from(suppliers).where(and(eq(suppliers.id, id), eq(suppliers.tenantId, tenantId)));
  if (!current) throw AppError.notFound("Supplier");

  const [updated] = await req.db!.update(suppliers).set({ status: "disqualified" }).where(eq(suppliers.id, id)).returning();
  await recordAuditTrail(req.db!, { tenantId, entityType: "Supplier", entityId: id, action: "status_change", changes: { action: "remove", from: current.status, to: "disqualified" }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "supplier", event: "remove", entityId: id });
  res.json(updated);
});
