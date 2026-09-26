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

/** Same inline-guard style as inventory.controller.ts/erp.controller.ts/rma.controller.ts's assertDepartment — Customer Service owns work orders (per explicit user request, 2026-09-15); every other read-level department (production/quality/material_management/purchasing) can view but never start/complete/cancel one. Admin/platform_admin bypass this entirely, which is how "General Manager" gets full access without a dedicated department. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin") return;
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
  const [row] = await req.db!.select().from(workOrders).where(and(eq(workOrders.id, id)));
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
    entityType: "WorkOrder",
    entityId: record.id,
    action: "status_change",
    changes: { oldStatus: record.status, newStatus },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "work_orders", event: newStatus, entityId: record.id });
  return { record, updated };
}

export const listWorkOrdersHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [];
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
  assertDepartment(req, ["customer_service"]);
  const { itemId, quantityPlanned, linkedNcrId, dueDate, notes } = req.body as {
    itemId: number;
    quantityPlanned: number;
    linkedNcrId?: number;
    dueDate?: Date;
    notes?: string;
  };

  // Real lookups before insert, not a raw FK violation surfacing as a 500 —
  // same fix already applied to RMA's createRmaHandler.
  const [item] = await req.db!.select({ id: inventoryItems.id }).from(inventoryItems).where(and(eq(inventoryItems.id, itemId)));
  if (!item) throw AppError.badRequest(`Inventory item #${itemId} not found`);
  if (linkedNcrId !== undefined) {
    const [linked] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, linkedNcrId)));
    if (!linked) throw AppError.badRequest(`NCR #${linkedNcrId} not found`);
  }

  const [created] = await req
    .db!.insert(workOrders)
    .values({ itemId, quantityPlanned: String(quantityPlanned), linkedNcrId, dueDate, notes, createdBy: req.user?.id })
    .returning();
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadWorkOrder(req, Number(req.params.id));
  const [item] = await req.db!.select().from(inventoryItems).where(eq(inventoryItems.id, record.itemId));
  const linkedNcr = record.linkedNcrId ? (await req.db!.select().from(ncr).where(eq(ncr.id, record.linkedNcrId)))[0] : null;
  const operations = await req.db!.select().from(workOrderOperations).where(and(eq(workOrderOperations.workOrderId, record.id))).orderBy(asc(workOrderOperations.opNumber));
  res.json({
    ...record,
    item: item ? { id: item.id, sku: item.sku, description: item.description, state: item.state } : null,
    linkedNcr: linkedNcr ? { id: linkedNcr.id, title: linkedNcr.title, status: linkedNcr.status, severity: linkedNcr.severity } : null,
    operations,
  });
});

export const updateWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  if (record.status !== "planned") {
    throw AppError.badRequest(`Cannot edit a work order that is "${record.status}", not "planned"`);
  }
  const [updated] = await req
    .db!.update(workOrders)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(workOrders.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const startWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
  const { updated } = await transition(req, Number(req.params.id), "in_progress");
  res.json(updated);
});

export const cancelWorkOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
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
  assertDepartment(req, ["customer_service"]);
  const { quantityCompleted } = req.body as { quantityCompleted: number };
  const { record, updated } = await transition(req, Number(req.params.id), "completed", { quantityCompleted: String(quantityCompleted) });

  await applyMovement(
    req.db!,
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
  assertDepartment(req, ["customer_service"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const [updated] = await req.db!.update(workOrders).set({ ...req.body, updatedAt: new Date() }).where(eq(workOrders.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "quality_gate_updated", ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});

export const signOperatorHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const { signature } = req.body as { signature: string };
  const [updated] = await req.db!.update(workOrders).set({ operatorSignature: signature, operatorSignedAt: new Date(), updatedAt: new Date() }).where(eq(workOrders.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operator_signed", signature }, performedBy: req.user?.id });
  res.json(updated);
});

export const signInspectorHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const { signature } = req.body as { signature: string };
  const [updated] = await req.db!.update(workOrders).set({ inspectorSignature: signature, inspectorSignedAt: new Date(), updatedAt: new Date() }).where(eq(workOrders.id, record.id)).returning();
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "inspector_signed", signature }, performedBy: req.user?.id });
  res.json(updated);
});

async function loadOperation(req: Request, workOrderId: number, opId: number) {
  const [row] = await req.db!.select().from(workOrderOperations).where(and(eq(workOrderOperations.id, opId), eq(workOrderOperations.workOrderId, workOrderId)));
  if (!row) throw AppError.notFound("Operation");
  return row;
}

export const createOperationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const [created] = await req.db!.insert(workOrderOperations).values({ ...req.body, workOrderId: record.id, }).returning();
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operation_added", ...req.body }, performedBy: req.user?.id });
  res.status(201).json(created);
});

/**
 * Drag-to-reorder for the routing table. Op numbers are the shop's own scheme (10, 20, 30...), so a reorder hands the
 * EXISTING numbers to the operations in their new order instead of inventing new ones. An operation that is already
 * signed off can't change position: its sign-off vouches for that step at that point in the routing.
 */
export const reorderOperationsHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const operations = await req.db!
    .select()
    .from(workOrderOperations)
    .where(and(eq(workOrderOperations.workOrderId, record.id)))
    .orderBy(asc(workOrderOperations.opNumber), asc(workOrderOperations.id));

  const ids = (req.body as { ids: number[] }).ids;
  const known = new Set(operations.map((o) => o.id));
  if (ids.length !== operations.length || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw AppError.badRequest("The new order has to list every operation on this traveler exactly once.");
  }

  const numbers = operations.map((o) => o.opNumber);
  const newNumber = new Map(ids.map((id, index) => [id, numbers[index]!]));
  const moved = operations.filter((o) => newNumber.get(o.id) !== o.opNumber);
  const signed = moved.find((o) => o.signOff);
  if (signed) throw AppError.badRequest(`Operation ${signed.opNumber} is already signed off and can't be moved.`);

  for (const op of moved) {
    await req.db!.update(workOrderOperations).set({ opNumber: newNumber.get(op.id)!, updatedAt: new Date() }).where(eq(workOrderOperations.id, op.id));
  }
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operations_reordered", order: ids }, performedBy: req.user?.id });

  const updated = await req.db!
    .select()
    .from(workOrderOperations)
    .where(and(eq(workOrderOperations.workOrderId, record.id)))
    .orderBy(asc(workOrderOperations.opNumber), asc(workOrderOperations.id));
  res.json(updated);
});

export const updateOperationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
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
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operation_updated", operationId: operation.id, ...req.body }, performedBy: req.user?.id });
  res.json(updated);
});

export const deleteOperationHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["customer_service"]);
  const record = await loadWorkOrder(req, Number(req.params.id));
  assertTravelerEditable(record.status);
  const operation = await loadOperation(req, record.id, Number(req.params.opId));
  await req.db!.delete(workOrderOperations).where(eq(workOrderOperations.id, operation.id));
  await recordAuditTrail(req.db!, { entityType: "WorkOrder", entityId: record.id, action: "update", changes: { subAction: "operation_removed", operationId: operation.id }, performedBy: req.user?.id });
  res.status(204).send();
});
