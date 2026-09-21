import type { Request, Response } from "express";
import { and, eq, or, ilike, desc, type SQL } from "drizzle-orm";
import { inventoryItems, inventoryStock, inventoryAlerts, inventoryMovements, inventoryReorderRequests } from "../../drizzle/schema/inventory.js";
import { inventoryLots } from "../../drizzle/schema/inventoryLots.js";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { crudFactory } from "../../utils/crudFactory.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import {
  applyMovement,
  recomputeState,
  getStockRows,
  createReorderRequest,
  reserveStock,
  releaseStock,
  applyReservationAutoRelease,
  computeAgingBucket,
  isCycleCountDue,
} from "./inventory.service.js";
import { getItemLots, getLotTraceability } from "./inventoryLots.service.js";
import { loadTenantForSettings, getInventorySettings } from "../settings/settings.service.js";
import { isObviousTestName } from "../../utils/testDataGuard.js";
import { env } from "../../config/env.js";

export const baseHandlers = crudFactory(inventoryItems, { entityName: "InventoryItem", idColumn: "id" });

/**
 * POST /inventory/items — not crudFactory.create as-is: a plain insert would
 * leave a brand-new item sitting at the "in_stock" column default even when
 * its own min_level is already above 0 on_hand (every item starts with zero
 * stock rows), which is a false "healthy" reading until its first movement
 * happens to run recomputeState. Insert, then immediately recompute once so
 * the state a caller sees is never stale from the moment of creation.
 */
export const createItemHandler = asyncHandler(async (req: Request, res: Response) => {
  // Phase 1 hygiene guardrail — see utils/testDataGuard.ts's own comment.
  // This is what would have caught TEST-CHANGED-COUNT/REORDER-TEST/
  // FALLBACK-TEST/PERF-TEST before they ever landed in the demo tenant.
  if (env.NODE_ENV === "production" && isObviousTestName(req.body.sku)) {
    throw AppError.badRequest(`Refusing to create SKU "${req.body.sku}" in production — it matches the naming pattern manual test data has used before. If this is a real part number, rename it to avoid that pattern.`);
  }

  const [created] = await req.db!
    .insert(inventoryItems)
    .values({ ...req.body, tenantId: req.tenantId! })
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "InventoryItem", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });

  const settled = await recomputeState(req.db!, req.tenantId!, created!.id, req.user?.id);
  res.status(201).json(settled);
});

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
  const lastAdjustedByItem = new Map<number, Date>();
  for (const row of stockRows) {
    onHandByItem.set(row.itemId, (onHandByItem.get(row.itemId) ?? 0) + Number(row.onHand));
    if (row.lastAdjustedAt) {
      const prev = lastAdjustedByItem.get(row.itemId);
      if (!prev || row.lastAdjustedAt > prev) lastAdjustedByItem.set(row.itemId, row.lastAdjustedAt);
    }
  }

  // Settings → Inventory Module expansion: aging + cycle count, computed
  // live for every row rather than stored — see inventory.service.ts's own
  // comments on computeAgingBucket/isCycleCountDue.
  const tenant = await loadTenantForSettings(req.db!, req.tenantId!);
  const settings = getInventorySettings(tenant);

  res.json(
    items.map((item) => {
      const lastActivity = lastAdjustedByItem.get(item.id) ?? item.createdAt ?? null;
      const daysSinceActivity = lastActivity ? Math.floor((Date.now() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)) : null;
      return {
        ...item,
        onHand: onHandByItem.get(item.id) ?? 0,
        agingBucket: computeAgingBucket(daysSinceActivity, settings.agingRules),
        cycleCountDue: isCycleCountDue(item.lastCountedAt, settings.auditFrequency),
      };
    })
  );
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
  const tenant = await loadTenantForSettings(req.db!, req.tenantId!);
  const settings = getInventorySettings(tenant);

  // Lazy reservation expiry — see applyReservationAutoRelease's own comment
  // on why this runs here (the one place a human actually looks at this
  // item's stock) rather than on every internal getStockRows call.
  await applyReservationAutoRelease(req.db!, req.tenantId!, id, settings);
  const stock = await getStockRows(req.db!, req.tenantId!, id);

  const lastActivity = stock.reduce<Date | null>((latest, row) => (row.lastAdjustedAt && (!latest || row.lastAdjustedAt > latest) ? row.lastAdjustedAt : latest), null) ?? item.createdAt ?? null;
  const daysSinceActivity = lastActivity ? Math.floor((Date.now() - lastActivity.getTime()) / (24 * 60 * 60 * 1000)) : null;

  res.json({
    ...item,
    stock,
    agingBucket: computeAgingBucket(daysSinceActivity, settings.agingRules),
    cycleCountDue: isCycleCountDue(item.lastCountedAt, settings.auditFrequency),
  });
});

export const movementHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const item = await loadItem(req, id);
  if (req.body.movementType === "consume") assertDepartment(req, ["production"]);
  // A raw material is never the output of a production step — only WIP
  // (an intermediate stage) or a finished good can be produced into.
  if (req.body.movementType === "produce" && item.itemType === "raw_material") {
    throw AppError.badRequest(`Cannot "produce" into a raw_material item — produce is only valid for wip or finished_good items`);
  }

  const tenant = await loadTenantForSettings(req.db!, req.tenantId!);
  const { movement } = await applyMovement(req.db!, req.tenantId!, id, req.body, req.user?.id, getInventorySettings(tenant));
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "InventoryItem",
    entityId: id,
    action: "update",
    changes: { movement: req.body.movementType, quantity: req.body.quantity, referenceType: req.body.referenceType, referenceId: req.body.referenceId, lotNumber: movement!.lotNumber, serialNumber: movement!.serialNumber },
    performedBy: req.user?.id,
  });

  const stock = await getStockRows(req.db!, req.tenantId!, id);
  res.status(201).json({ movement, stock });
});

/** POST /inventory/items/:id/reserve — see inventory.service.ts's reserveStock for the reservationRules it honors. */
export const reserveHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  const { quantity, location } = req.body as { quantity: number; location?: string };
  const tenant = await loadTenantForSettings(req.db!, req.tenantId!);
  const stock = await reserveStock(req.db!, req.tenantId!, id, quantity, location, getInventorySettings(tenant), req.user?.id);
  res.status(201).json({ stock });
});

/** POST /inventory/items/:id/release — the inverse of reserve. */
export const releaseHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  const { quantity, location } = req.body as { quantity: number; location?: string };
  const stock = await releaseStock(req.db!, req.tenantId!, id, quantity, location, req.user?.id);
  res.status(201).json({ stock });
});

/**
 * POST /inventory/items/:id/count — records a real cycle count event
 * (stamps lastCountedAt, which isCycleCountDue then measures against
 * inventorySettings.auditFrequency). No separate cycle-count workflow/UI —
 * this is the minimal real hook the "cycle count scheduling" integration
 * point needs, not a fabricated full count-sheet feature.
 */
export const recordCycleCountHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  const { notes } = req.body as { notes?: string };

  const [updated] = await req.db!.update(inventoryItems).set({ lastCountedAt: new Date(), updatedAt: new Date() }).where(eq(inventoryItems.id, id)).returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "InventoryItem", entityId: id, action: "update", changes: { cycleCounted: true, notes }, performedBy: req.user?.id });
  res.json(updated);
});

/** POST /inventory/items/:id/adjust — a thin, material_management-only wrapper around applyMovement("adjust", <signed delta>). */
export const adjustHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  assertDepartment(req, ["material_management"]);

  const { quantity, location, reason, referenceType, referenceId } = req.body as { quantity: number; location?: string; reason: string; referenceType?: string; referenceId?: string };
  const { movement } = await applyMovement(req.db!, req.tenantId!, id, { movementType: "adjust", quantity, fromLocation: location, reason, referenceType, referenceId }, req.user?.id);
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "InventoryItem",
    entityId: id,
    action: "update",
    changes: { adjust: quantity, reason, referenceType, referenceId },
    performedBy: req.user?.id,
  });

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
  return updated!;
}

/** The real trigger for the ERP reorder stub: reorder_pending is only ever reached here, never by min/max evaluation (see recomputeState). */
export const markReorderPendingHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await setStatus(req, res, "mark-reorder-pending", "below_min", "reorder_pending");
  const stock = await getStockRows(req.db!, req.tenantId!, updated.id);
  const onHand = stock.reduce((sum, s) => sum + Number(s.onHand), 0);
  await createReorderRequest(req.db!, req.tenantId!, updated, onHand, req.user?.id);
  res.json(updated);
});
export const markOnOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const updated = await setStatus(req, res, "mark-on-order", "reorder_pending", "on_order");
  res.json(updated);
});

/** GET /inventory/reorder-requests?itemId=... — itemId optional (omit for every request across the tenant). */
export const listReorderRequestsHandler = asyncHandler(async (req: Request, res: Response) => {
  const itemId = req.query.itemId ? Number(req.query.itemId) : undefined;
  const rows = await req.db!
    .select()
    .from(inventoryReorderRequests)
    .where(itemId ? and(eq(inventoryReorderRequests.tenantId, req.tenantId!), eq(inventoryReorderRequests.itemId, itemId)) : eq(inventoryReorderRequests.tenantId, req.tenantId!))
    .orderBy(desc(inventoryReorderRequests.createdAt));
  res.json(rows);
});

async function loadReorderRequest(req: Request, id: number) {
  const [request] = await req.db!
    .select()
    .from(inventoryReorderRequests)
    .where(and(eq(inventoryReorderRequests.id, id), eq(inventoryReorderRequests.tenantId, req.tenantId!)));
  if (!request) throw AppError.notFound("InventoryReorderRequest");
  return request;
}

/** POST /inventory/reorder-requests/:id/send — purchasing-only. Marks the request sent and moves the item to on_order, same transition as the direct mark-on-order action. */
export const sendReorderRequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const request = await loadReorderRequest(req, id);
  assertDepartment(req, ["purchasing"]);
  if (request.status !== "pending") throw AppError.badRequest(`Cannot "send" — request is already "${request.status}"`);

  const item = await loadItem(req, request.itemId);
  if (item.state !== "reorder_pending") {
    throw AppError.badRequest(`Cannot "send" — item is "${item.state}", expected "reorder_pending"`);
  }

  const [updatedRequest] = await req.db!.update(inventoryReorderRequests).set({ status: "sent", updatedAt: new Date() }).where(eq(inventoryReorderRequests.id, id)).returning();
  await req.db!.update(inventoryItems).set({ state: "on_order", updatedAt: new Date() }).where(eq(inventoryItems.id, item.id));
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "InventoryItem",
    entityId: item.id,
    action: "status_change",
    changes: { reorderRequestId: id, newStatus: "sent", from: "reorder_pending", to: "on_order" },
    performedBy: req.user?.id,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId: req.tenantId!, module: "inventory", event: "reorder-sent", entityId: item.id });
  res.json(updatedRequest);
});

/**
 * POST /inventory/reorder-requests/:id/ignore — purchasing-only. Marks the
 * request ignored and recomputes the item's real state (rather than
 * hardcoding "in_stock" or "reorder_pending", neither of which reflects
 * actual on-hand — see the ERP Reorder Request review).
 */
export const ignoreReorderRequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const request = await loadReorderRequest(req, id);
  assertDepartment(req, ["purchasing"]);
  if (request.status !== "pending") throw AppError.badRequest(`Cannot "ignore" — request is already "${request.status}"`);

  const [updatedRequest] = await req.db!.update(inventoryReorderRequests).set({ status: "ignored", updatedAt: new Date() }).where(eq(inventoryReorderRequests.id, id)).returning();

  // Undo the reorder_pending purchasing decision first (recomputeState never
  // downgrades reorder_pending/on_order on its own — see its own comment),
  // then let a real recompute decide the honest resulting state.
  await req.db!.update(inventoryItems).set({ state: "below_min", updatedAt: new Date() }).where(eq(inventoryItems.id, request.itemId));
  const settled = await recomputeState(req.db!, req.tenantId!, request.itemId, req.user?.id);

  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "InventoryItem",
    entityId: request.itemId,
    action: "status_change",
    changes: { reorderRequestId: id, newStatus: "ignored", resultingState: settled.state },
    performedBy: req.user?.id,
  });
  res.json(updatedRequest);
});

/** POST /inventory/reorder-requests/:id/notes — purchasing-only, any status. */
export const notesReorderRequestHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const request = await loadReorderRequest(req, id);
  assertDepartment(req, ["purchasing"]);
  const { notes } = req.body as { notes: string };

  const [updated] = await req.db!.update(inventoryReorderRequests).set({ notes, updatedAt: new Date() }).where(eq(inventoryReorderRequests.id, id)).returning();
  await recordAuditTrail(req.db!, {
    tenantId: req.tenantId!,
    entityType: "InventoryItem",
    entityId: request.itemId,
    action: "update",
    changes: { reorderRequestId: id, notes },
    performedBy: req.user?.id,
  });
  res.json(updated);
});

/**
 * GET /inventory/lots?q=&status= — tenant-wide lot/serial visibility. Phase
 * 8's per-item lot list and lot-trace endpoint both required already
 * knowing which item to start from; a real recall/traceability
 * investigation usually starts from a lot number, a serial number, or a
 * SKU pulled off a customer complaint or a shipping label, not from
 * browsing the item roster first. q matches any of those three (same
 * ilike-OR-across-columns shape rmaLog/warranty/crar's own ?q= filters
 * already use, just spread across a join instead of one table's columns);
 * status narrows to one lot lifecycle state. Same base read gate as every
 * other GET on this router (quality is read-only here, not blocked).
 */
export const searchLotsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { q, status } = req.query as Record<string, string | undefined>;
  const conditions: SQL[] = [eq(inventoryLots.tenantId, req.tenantId!)];
  if (status) conditions.push(eq(inventoryLots.status, status));
  if (q) {
    const match = or(ilike(inventoryLots.lotNumber, `%${q}%`), ilike(inventoryLots.serialNumber, `%${q}%`), ilike(inventoryItems.sku, `%${q}%`));
    if (match) conditions.push(match);
  }

  const rows = await req.db!
    .select({
      id: inventoryLots.id,
      tenantId: inventoryLots.tenantId,
      itemId: inventoryLots.itemId,
      sku: inventoryItems.sku,
      description: inventoryItems.description,
      lotNumber: inventoryLots.lotNumber,
      serialNumber: inventoryLots.serialNumber,
      supplierId: inventoryLots.supplierId,
      purchaseOrderId: inventoryLots.purchaseOrderId,
      receivingLineItemId: inventoryLots.receivingLineItemId,
      revisionLevel: inventoryLots.revisionLevel,
      expirationDate: inventoryLots.expirationDate,
      receivedQty: inventoryLots.receivedQty,
      remainingQty: inventoryLots.remainingQty,
      heldQty: inventoryLots.heldQty,
      status: inventoryLots.status,
      createdAt: inventoryLots.createdAt,
    })
    .from(inventoryLots)
    .innerJoin(inventoryItems, eq(inventoryLots.itemId, inventoryItems.id))
    .where(and(...conditions))
    .orderBy(desc(inventoryLots.createdAt));

  res.json(rows);
});

/** GET /inventory/items/:id/lots — Phase 8 traceability (task 4): every real per-lot record for this item, newest first. */
export const listItemLotsHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  await loadItem(req, id);
  res.json(await getItemLots(req.db!, req.tenantId!, id));
});

/** GET /inventory/lots/:id/trace — the full receiving → inventory chain for one lot; see inventoryLots.service.ts's own comment. */
export const traceLotHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  res.json(await getLotTraceability(req.db!, req.tenantId!, id));
});

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

/**
 * GET /inventory/alerts — every alert for the tenant, newest first, joined
 * live with the item's identifying + threshold fields (never denormalized
 * onto the alert row — see the Alerts UI review) plus a summed current
 * stock, same aggregation approach as listItemsHandler.
 */
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
      itemType: inventoryItems.itemType,
      minLevel: inventoryItems.minLevel,
      reorderQuantity: inventoryItems.reorderQuantity,
    })
    .from(inventoryAlerts)
    .innerJoin(inventoryItems, eq(inventoryAlerts.itemId, inventoryItems.id))
    .where(eq(inventoryAlerts.tenantId, req.tenantId!))
    .orderBy(desc(inventoryAlerts.triggeredAt));

  const stockRows = await req.db!.select().from(inventoryStock).where(eq(inventoryStock.tenantId, req.tenantId!));
  const onHandByItem = new Map<number, number>();
  for (const row of stockRows) onHandByItem.set(row.itemId, (onHandByItem.get(row.itemId) ?? 0) + Number(row.onHand));

  res.json(rows.map((r) => ({ ...r, currentStock: onHandByItem.get(r.itemId) ?? 0 })));
});

/**
 * GET /inventory/alerts/routing — real recipient counts for a below_min
 * notification (see notification.service.ts's notifyDepartment), not the
 * fictional single "department email" the Alerts UI review flagged. Open
 * to any department with inventory access (not admin/quality_manager-only
 * like GET /users) since it's an aggregate count, not per-user data.
 */
export const alertRoutingHandler = asyncHandler(async (req: Request, res: Response) => {
  const recipients = await req.db!
    .select({ department: users.department })
    .from(users)
    .where(and(eq(users.tenantId, req.tenantId!), eq(users.isActive, true)));

  res.json({
    material_management: recipients.filter((u) => u.department === "material_management").length,
    purchasing: recipients.filter((u) => u.department === "purchasing").length,
  });
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

/**
 * POST /inventory/check-minmax — manual recompute; itemId in body recomputes
 * one item, omitted recomputes every item for the tenant. `changed` counts
 * only items whose state actually moved (recomputeState returns every
 * evaluated item regardless, since it's also used internally after every
 * movement) — reported separately so a caller isn't left assuming "checked"
 * means "changed".
 */
export const checkMinMaxHandler = asyncHandler(async (req: Request, res: Response) => {
  const { itemId } = req.body as { itemId?: number };
  const targets = itemId
    ? await req.db!.select().from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, req.tenantId!)))
    : await req.db!.select().from(inventoryItems).where(eq(inventoryItems.tenantId, req.tenantId!));
  if (itemId && targets.length === 0) throw AppError.notFound("InventoryItem");

  const results = [];
  let changed = 0;
  for (const item of targets) {
    const updated = await recomputeState(req.db!, req.tenantId!, item.id, req.user?.id);
    if (updated.state !== item.state) changed++;
    results.push(updated);
  }
  res.json({ checked: results.length, changed, items: results });
});

/**
 * Not crudFactory.update as-is, for the same reason createItemHandler isn't
 * crudFactory.create: minLevel/maxLevel/active are exactly recomputeState's
 * inputs, so a plain PATCH would leave `state` stale until the next
 * movement or a manual check-minmax (e.g. deactivating an item wouldn't
 * actually show "inactive" until something else happened to touch it).
 * Deactivation is also admin-only — no department may set active:false.
 */
export const updateItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (req.body.active === false) {
    assertDepartment(req, []); // admin/platform_admin only
  }

  const [updated] = await req.db!
    .update(inventoryItems)
    .set({ ...req.body, updatedAt: new Date() })
    .where(and(eq(inventoryItems.id, id), eq(inventoryItems.tenantId, req.tenantId!)))
    .returning();
  if (!updated) throw AppError.notFound("InventoryItem");

  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "InventoryItem", entityId: id, action: "update", changes: req.body, performedBy: req.user?.id });
  const settled = await recomputeState(req.db!, req.tenantId!, id, req.user?.id);
  res.json(settled);
});
