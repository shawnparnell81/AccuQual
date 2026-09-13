import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { inventoryItems, inventoryStock, inventoryAlerts, inventoryMovements } from "../../drizzle/schema/inventory.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { applyMovement, recomputeState, getStockRows } from "./inventory.service.js";

export const baseHandlers = crudFactory(inventoryItems, { entityName: "InventoryItem", idColumn: "id" });

/**
 * GET /inventory/items — crudFactory.list's plain item rows plus a summed
 * on_hand per item, so the list page can show real stock without every
 * caller having to fetch each item's stock rows separately. Aggregated in
 * JS rather than a SQL group-by: tenant-scoped item/stock tables are small
 * (QMS-scale, not warehouse-scale), and this keeps the query as two plain
 * selects instead of a raw SQL escape hatch.
 */
export const listItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const items = await req.db!.select().from(inventoryItems).where(eq(inventoryItems.tenantId, req.tenantId!));
  const stockRows = await req.db!.select().from(inventoryStock).where(eq(inventoryStock.tenantId, req.tenantId!));

  const onHandByItem = new Map<number, number>();
  for (const row of stockRows) {
    onHandByItem.set(row.itemId, (onHandByItem.get(row.itemId) ?? 0) + Number(row.onHand));
  }

  res.json(items.map((item) => ({ ...item, onHand: onHandByItem.get(item.id) ?? 0 })));
});

/**
 * Only "consume" and "adjust" get a department restriction narrower than
 * the base requireDepartmentAccess("inventory") edit gate (see the
 * Inventory module plan's Permissions section) — every other movement
 * type just needs the ordinary edit access every edit-level department
 * already has.
 */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

async function loadItem(req: Request, id: number) {
  const [item] = await req.db!.select().from(inventoryItems).where(and(eq(inventoryItems.id, id), eq(inventoryItems.tenantId, req.tenantId!)));
  if (!item) throw AppError.notFound("InventoryItem");
  return item;
}

/** GET /inventory/items/:id — the item plus its real per-location stock rows (crudFactory.getOne only returns the item row). */
export const getItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const item = await loadItem(req, id);
  const stock = await getStockRows(req.db!, req.tenantId!, id);
  res.json({ ...item, stock });
});

export const movementHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  if (req.body.movementType === "consume") assertDepartment(req, ["production"]);

  const { movement } = await applyMovement(req.db!, req.tenantId!, id, req.body, req.user?.id);
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "InventoryItem",
    entityId: id,
    action: "update",
    changes: { movement: req.body.movementType, quantity: req.body.quantity },
    performedBy: req.user?.id,
  });

  const stock = await getStockRows(req.db!, req.tenantId!, id);
  res.status(201).json({ movement, stock });
});

/** POST /inventory/items/:id/adjust — a thin, material_management-only wrapper around applyMovement("adjust", <signed delta>). */
export const adjustHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  assertDepartment(req, ["material_management"]);

  const { quantity, location, reason } = req.body as { quantity: number; location?: string; reason: string };
  const { movement } = await applyMovement(req.db!, req.tenantId!, id, { movementType: "adjust", quantity, fromLocation: location, reason }, req.user?.id);
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "InventoryItem", entityId: id, action: "update", changes: { adjust: quantity, reason }, performedBy: req.user?.id });

  const stock = await getStockRows(req.db!, req.tenantId!, id);
  res.status(201).json({ movement, stock });
});

async function setStatus(req: Request, res: Response, action: string, fromState: string, toState: string) {
  const id = Number(req.params.id);
  const item = await loadItem(req, id);
  assertDepartment(req, ["purchasing"]);
  if (item.state !== fromState) {
    throw AppError.badRequest(`Cannot "${action}" — item is "${item.state}", expected "${fromState}"`);
  }

  const [updated] = await req.db!.update(inventoryItems).set({ state: toState, updatedAt: new Date() }).where(eq(inventoryItems.id, id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "InventoryItem", entityId: id, action: "status_change", changes: { action, from: fromState, to: toState }, performedBy: req.user?.id });
  await publishEvent(WORKFLOW_STREAM, { tenantId: req.tenantId!, module: "inventory", event: action, entityId: id });
  res.json(updated);
}

export const markReorderPendingHandler = asyncHandler((req: Request, res: Response) => setStatus(req, res, "mark-reorder-pending", "below_min", "reorder_pending"));
export const markOnOrderHandler = asyncHandler((req: Request, res: Response) => setStatus(req, res, "mark-on-order", "reorder_pending", "on_order"));

/** GET /inventory/items/:id/history — the raw movement ledger, separate from the generic audit trail (which only records state changes and edits, not every stock movement's own row). */
export const historyHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  const rows = await req.db!
    .select()
    .from(inventoryMovements)
    .where(and(eq(inventoryMovements.itemId, id), eq(inventoryMovements.tenantId, req.tenantId!)))
    .orderBy(desc(inventoryMovements.performedAt));
  res.json(rows);
});

/** GET /inventory/alerts — every alert for the tenant, newest first, joined with the item's identifying fields. */
export const listAlertsHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!
    .select({
      id: inventoryAlerts.id,
      itemId: inventoryAlerts.itemId,
      alertType: inventoryAlerts.alertType,
      triggeredAt: inventoryAlerts.triggeredAt,
      acknowledgedAt: inventoryAlerts.acknowledgedAt,
      acknowledgedBy: inventoryAlerts.acknowledgedBy,
      sku: inventoryItems.sku,
      description: inventoryItems.description,
    })
    .from(inventoryAlerts)
    .innerJoin(inventoryItems, eq(inventoryAlerts.itemId, inventoryItems.id))
    .where(eq(inventoryAlerts.tenantId, req.tenantId!))
    .orderBy(desc(inventoryAlerts.triggeredAt));
  res.json(rows);
});

export const acknowledgeAlertHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [alert] = await req.db!.select().from(inventoryAlerts).where(and(eq(inventoryAlerts.id, id), eq(inventoryAlerts.tenantId, req.tenantId!)));
  if (!alert) throw AppError.notFound("InventoryAlert");

  const [updated] = await req.db!
    .update(inventoryAlerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: req.user?.id })
    .where(eq(inventoryAlerts.id, id))
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "InventoryAlert", entityId: id, action: "update", changes: { acknowledged: true }, performedBy: req.user?.id });
  res.json(updated);
});

/** POST /inventory/check-minmax — manual recompute; itemId in body recomputes one item, omitted recomputes every item for the tenant. */
export const checkMinMaxHandler = asyncHandler(async (req: Request, res: Response) => {
  const { itemId } = req.body as { itemId?: number };

  if (itemId) {
    const updated = await recomputeState(req.db!, req.tenantId!, itemId, req.user?.id);
    return res.json({ checked: 1, items: [updated] });
  }

  const items = await req.db!.select().from(inventoryItems).where(eq(inventoryItems.tenantId, req.tenantId!));
  const results = [];
  for (const item of items) {
    results.push(await recomputeState(req.db!, req.tenantId!, item.id, req.user?.id));
  }
  res.json({ checked: results.length, items: results });
});

/** Deactivation is admin-only — a lighter guard than a full crudFactory.update override, since every other field on PATCH stays open to any edit-level department. */
export const updateItemHandler = asyncHandler(async (req: Request, res: Response, next) => {
  if (typeof req.body.active === "boolean" && req.body.active === false) {
    assertDepartment(req, []); // admin/platform_admin only — no department is allowed to deactivate
  }
  return baseHandlers.update(req, res, next);
});
