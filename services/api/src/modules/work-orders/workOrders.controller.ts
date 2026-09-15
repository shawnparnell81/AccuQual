import type { Request, Response } from "express";
import { and, eq, asc, desc } from "drizzle-orm";
import { workOrders, workOrderOperations } from "../../drizzle/schema/workOrders.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { applyMovement } from "../inventory/inventory.service.js";

/** Same inline-guard style as inventory.controller.ts/erp.controller.ts/rma.controller.ts's assertDepartment — production owns work orders; the matrix's read-level departments (quality/material_management/purchasing) can't start/complete/cancel one. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

const ALLOWED_NEXT: Record<string, string[]> = {
  planned: ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};

async function loadWorkOrder(req: Request, id: number) {
  const [row] = await req.db!.select().from(workOrders).where(and(eq(workOrders.id, id), eq(workOrders.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("WorkOrder");
  return row;
}

async function transition(req: Request, id: number, newStatus: string, patch: Record<string, unknown> = {}) {
  const record = await loadWorkOrder(req, id);
  if (!ALLOWED_NEXT[record.status]?.includes(newStatus)) {
    throw AppError.badRequest(`Cannot move a work order from "${record.status}" to "${newStatus}"`);
  }
  const [updated] = await req
    .db!.update(workOrders)
    .set({ status: newStatus, updatedAt: new Date(), ...patch })
    .where(eq(workOrders.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "WorkOrder",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId: req.tenantId!, module: "work_orders", event: newStatus, entityId: record.id });
  return { record, updated };
}

export const listWorkOrdersHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [eq(workOrders.tenantId, req.tenantId!)];
  if (status) conditions.push(eq(workOrders.status, status));

  const rows = await req
    .db!.select({
      id: workOrders.id,
      itemId: workOrders.itemId,
      sku: inventoryItems.sku,
      description: inventoryItems.description,
      quantityPlanned: workOrders.quantityPlanned,
      quantityCompleted: workOrders.quantityCompleted,
      status: workOrders.status,
      linkedNcrId: workOrders.linkedNcrId,
      dueDate: workOrders.dueDate,
      createdAt: workOrders.createdAt,
    })
    .from(workOrders)
    .innerJoin(inventoryItems, eq(workOrders.itemId, inventoryItems.id))
    .where(and(...conditions))
    .orderBy(desc(workOrders.createdAt));
  res.json(rows);
});

export const createWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const { itemId, quantityPlanned, linkedNcrId, dueDate, notes } = req.body as {
    itemId: number;
    quantityPlanned: number;
    linkedNcrId?: number;
    dueDate?: Date;
    notes?: string;
  };

  // Real lookups before insert, not a raw FK violation surfacing as a 500 —
  // same fix already applied to RMA's createRmaHandler.
  const [item] = await req.db!.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, req.tenantId!)));
  if (!item) throw AppError.badRequest(`Inventory item #${itemId} not found`);
  if (linkedNcrId !== undefined) {
    const [linked] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, linkedNcrId), eq(ncr.tenantId, req.tenantId!)));
    if (!linked) throw AppError.badRequest(`NCR #${linkedNcrId} not found`);
  }

  const [created] = await req
    .db!.insert(workOrders)
    .values({ tenantId: req.tenantId!, itemId, quantityPlanned: String(quantityPlanned), linkedNcrId, dueDate, notes, createdBy: req.user?.id })
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadWorkOrder(req, Number(req.params.id));
  const [item] = await req.db!.select().from(inventoryItems).where(eq(inventoryItems.id, record.itemId));
  const linkedNcr = record.linkedNcrId ? (await req.db!.select().from(ncr).where(eq(ncr.id, record.linkedNcrId)))[0] : null;
  const operations = await req.db!.select().from(workOrderOperations).where(and(eq(workOrderOperations.workOrderId, record.id), eq(workOrderOperations.tenantId, req.tenantId!))).orderBy(asc(workOrderOperations.opNumber));
  res.json({
    ...record,
    item: item ? { id: item.id, sku: item.sku, description: item.description, state: item.state } : null,
    linkedNcr: linkedNcr ? { id: linkedNcr.id, title: linkedNcr.title, status: linkedNcr.status, severity: linkedNcr.severity } : null,
    operations,
  });
});

export const updateWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  if (record.status !== "planned") {
    throw AppError.badRequest(`Cannot edit a work order that is "${record.status}", not "planned"`);
  }
  const [updated] = await req
    .db!.update(workOrders)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(workOrders.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const startWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const { updated } = await transition(req, Number(req.params.id), "in_progress");
  res.json(updated);
});

export const cancelWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const { updated } = await transition(req, Number(req.params.id), "cancelled");
  res.json(updated);
});

/**
 * Completing a work order is the one action that actually moves real
 * inventory — logs a "produce" movement via inventory.service.ts's
 * existing applyMovement (the same function inventory.controller.ts uses),
 * tagged referenceType="work_order"/referenceId=String(id) so the item's
 * ledger shows exactly which work order produced the stock. Runs inside
 * the caller's per-request transaction, atomic with the status update.
 */
export const completeWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const { quantityCompleted } = req.body as { quantityCompleted: number };
  const { record, updated } = await transition(req, Number(req.params.id), "completed", { quantityCompleted: String(quantityCompleted) });

  await applyMovement(
    req.db!,
    req.tenantId!,
    record.itemId,
    { movementType: "produce", quantity: quantityCompleted, referenceType: "work_order", referenceId: String(record.id) },
    req.user?.id
  );

  res.json(updated);
});

// ---- Production Work Order traveler (bespoke standalone page, not the shared forms engine — see workOrders.ts's schema comment) ----

/** Shop-floor execution data (quality gates, signatures, operations) stays editable through in_progress/completed — only a cancelled work order's traveler is locked, unlike the "planned"-only guard on updateWorkOrderHandler's planning fields. */
function assertTravelerEditable(status: string) {
  if (status === "cancelled") throw AppError.badRequest("Cannot edit the traveler on a cancelled work order.");
}

export const updateQualityGatesHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const [updated] = await req.db!.update(workOrders).set({ ...req.body, updatedAt: new Date() }).where(eq(workOrders.id, record.id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "quality_gate_updated", ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});

export const signOperatorHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const { signature } = req.body as { signature: string };
  const [updated] = await req.db!.update(workOrders).set({ operatorSignature: signature, operatorSignedAt: new Date(), updatedAt: new Date() }).where(eq(workOrders.id, record.id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operator_signed", signature }, performedBy: req.user?.id });
  res.json(updated);
});

export const signInspectorHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const { signature } = req.body as { signature: string };
  const [updated] = await req.db!.update(workOrders).set({ inspectorSignature: signature, inspectorSignedAt: new Date(), updatedAt: new Date() }).where(eq(workOrders.id, record.id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "inspector_signed", signature }, performedBy: req.user?.id });
  res.json(updated);
});

async function loadOperation(req: Request, workOrderId: number, opId: number) {
  const [row] = await req.db!.select().from(workOrderOperations).where(and(eq(workOrderOperations.id, opId), eq(workOrderOperations.workOrderId, workOrderId), eq(workOrderOperations.tenantId, req.tenantId!)));
  if (!row) throw AppError.notFound("Operation");
  return row;
}

export const createOperationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const [created] = await req.db!.insert(workOrderOperations).values({ ...req.body, workOrderId: record.id, tenantId: req.tenantId! }).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operation_added", ...req.body }, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const updateOperationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const operation = await loadOperation(req, record.id, Number(req.params.opId));
  const { signOff, ...rest } = req.body as { signOff?: string | null } & Record<string, unknown>;
  const patch: Record<string, unknown> = { ...rest, updatedAt: new Date() };
  // signOffDate is always server-stamped the moment signOff is first set — never client-supplied (same reasoning as operator/inspector signedAt above).
  if (signOff !== undefined) {
    patch.signOff = signOff;
    patch.signOffDate = signOff && !operation.signOff ? new Date() : signOff ? operation.signOffDate : null;
  }
  const [updated] = await req.db!.update(workOrderOperations).set(patch).where(eq(workOrderOperations.id, operation.id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operation_updated", operationId: operation.id, ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteOperationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["production"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const operation = await loadOperation(req, record.id, Number(req.params.opId));
  await req.db!.delete(workOrderOperations).where(eq(workOrderOperations.id, operation.id));
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operation_removed", operationId: operation.id }, performedBy: req.user?.id });
  res.status(204).send();
});
