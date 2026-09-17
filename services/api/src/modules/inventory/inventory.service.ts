import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { inventoryItems, inventoryStock, inventoryMovements, inventoryAlerts, inventoryReorderRequests, type InventoryItem } from "../../drizzle/schema/inventory.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { notifyDepartment } from "../notifications/notification.service.js";
import type { InventorySettings } from "../settings/settings.service.js";
import { consumeFromLot } from "./inventoryLots.service.js";

const DEFAULT_LOCATION = "default";

export async function getStockRows(db: TenantDb, tenantId: number, itemId: number) {
  return db.select().from(inventoryStock).where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.tenantId, tenantId)));
}

/** Finds (or lazily creates) the one stock row for an item at a location — items start with no stock rows until their first movement. */
async function getOrCreateStockRow(db: TenantDb, tenantId: number, itemId: number, location: string) {
  const [existing] = await db
    .select()
    .from(inventoryStock)
    .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.tenantId, tenantId), eq(inventoryStock.location, location)));
  if (existing) return existing;

  const [created] = await db.insert(inventoryStock).values({ tenantId, itemId, location, onHand: "0", allocated: "0", onOrder: "0" }).returning();
  return created!;
}

async function setOnHand(db: TenantDb, tenantId: number, itemId: number, location: string, newOnHand: number, performedBy?: number) {
  if (newOnHand < 0) throw AppError.badRequest(`Insufficient stock at location "${location}"`);
  await getOrCreateStockRow(db, tenantId, itemId, location);
  await db
    .update(inventoryStock)
    .set({ onHand: String(newOnHand), lastAdjustedAt: new Date(), lastAdjustedBy: performedBy })
    .where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.tenantId, tenantId), eq(inventoryStock.location, location)));
}

export interface MovementInput {
  movementType: "receive" | "consume" | "produce" | "adjust" | "scrap" | "transfer" | "return";
  quantity: number; // positive magnitude, except "adjust" which passes a signed delta
  fromLocation?: string;
  toLocation?: string;
  reason?: string;
  /** User-set manual tags — no Production Work Order module exists to populate these automatically. */
  referenceType?: string;
  referenceId?: string;
  /** Caller-supplied — auto-generated instead when unset and settings say to (see generateTrackingNumber below). */
  lotNumber?: string;
  serialNumber?: string;
  /** Phase 8 — ties this movement to a real inventory_lots row; see inventoryLots.service.ts. */
  lotId?: number;
}

/**
 * Settings → Inventory Module expansion: {SKU}/{YYYY}/{MM}/{DD}/{SEQ} token
 * substitution for lotNumberFormat/serialNumberFormat. SEQ is a simple
 * "count of this item's past movements that already carry this kind of
 * tracking number, plus one" — not a real database sequence object (no
 * concurrent-safe sequence per item/format exists, and at QMS scale, not
 * warehouse scale, a rare double-count under true concurrent receiving is an
 * acceptable, documented tradeoff rather than new schema for it), zero-padded
 * to 4 digits.
 */
export function generateTrackingNumber(format: string, sku: string, seq: number): string {
  const now = new Date();
  const pad = (n: number, len = 2) => String(n).padStart(len, "0");
  return format
    .replace(/\{SKU\}/g, sku)
    .replace(/\{YYYY\}/g, String(now.getFullYear()))
    .replace(/\{MM\}/g, pad(now.getMonth() + 1))
    .replace(/\{DD\}/g, pad(now.getDate()))
    .replace(/\{SEQ\}/g, pad(seq, 4));
}

/** Applies one movement's stock effect, inserts the ledger row, then recomputes state. Runs inside the caller's per-request transaction (req.db) — atomic with the rest of the request. */
export async function applyMovement(db: TenantDb, tenantId: number, itemId: number, input: MovementInput, performedBy: number | undefined, inventorySettings?: InventorySettings) {
  const stockRows = await getStockRows(db, tenantId, itemId);
  const totalBefore = stockRows.reduce((sum, r) => sum + Number(r.onHand), 0);

  switch (input.movementType) {
    case "receive":
    case "produce": {
      const loc = input.toLocation ?? DEFAULT_LOCATION;
      const row = await getOrCreateStockRow(db, tenantId, itemId, loc);
      await setOnHand(db, tenantId, itemId, loc, Number(row.onHand) + input.quantity, performedBy);
      break;
    }
    case "consume":
    case "scrap":
    case "return": {
      const loc = input.fromLocation ?? DEFAULT_LOCATION;
      const row = await getOrCreateStockRow(db, tenantId, itemId, loc);
      await setOnHand(db, tenantId, itemId, loc, Number(row.onHand) - input.quantity, performedBy);
      break;
    }
    case "transfer": {
      const from = input.fromLocation!;
      const to = input.toLocation!;
      const fromRow = await getOrCreateStockRow(db, tenantId, itemId, from);
      await setOnHand(db, tenantId, itemId, from, Number(fromRow.onHand) - input.quantity, performedBy);
      const toRow = await getOrCreateStockRow(db, tenantId, itemId, to);
      await setOnHand(db, tenantId, itemId, to, Number(toRow.onHand) + input.quantity, performedBy);
      break;
    }
    case "adjust": {
      const loc = input.fromLocation ?? input.toLocation ?? DEFAULT_LOCATION;
      const row = await getOrCreateStockRow(db, tenantId, itemId, loc);
      await setOnHand(db, tenantId, itemId, loc, Number(row.onHand) + input.quantity, performedBy); // signed delta
      break;
    }
  }

  // Settings → Inventory Module expansion: auto-generate lot/serial numbers
  // on the two movement types that actually bring new units into existence
  // (receive from a supplier, produce from a WIP/finished-good step) — never
  // overrides a caller-supplied value.
  let lotNumber = input.lotNumber;
  let serialNumber = input.serialNumber;
  if (input.movementType === "receive" || input.movementType === "produce") {
    const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
    const sku = item?.sku ?? "ITEM";
    if (!lotNumber && inventorySettings?.autoGenerateLotNumbers && inventorySettings.lotNumberFormat) {
      const priorCount = (await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.itemId, itemId), isNotNull(inventoryMovements.lotNumber)))).length;
      lotNumber = generateTrackingNumber(inventorySettings.lotNumberFormat, sku, priorCount + 1);
    }
    if (!serialNumber && inventorySettings?.autoGenerateSerialNumbers && inventorySettings.serialNumberFormat) {
      const priorCount = (await db.select().from(inventoryMovements).where(and(eq(inventoryMovements.tenantId, tenantId), eq(inventoryMovements.itemId, itemId), isNotNull(inventoryMovements.serialNumber)))).length;
      serialNumber = generateTrackingNumber(inventorySettings.serialNumberFormat, sku, priorCount + 1);
    }
  }

  const [movement] = await db
    .insert(inventoryMovements)
    .values({
      tenantId,
      itemId,
      movementType: input.movementType,
      quantity: String(Math.abs(input.quantity)),
      fromLocation: input.fromLocation,
      toLocation: input.toLocation,
      reason: input.reason,
      referenceType: input.referenceType,
      referenceId: input.referenceId,
      lotNumber,
      serialNumber,
      lotId: input.lotId,
      performedBy,
    })
    .returning();

  // Phase 8 — decrement the real per-lot ledger on any outbound movement
  // against a tracked lot (transfer moves between locations, not out of
  // inventory at all, so it's excluded — see inventoryLots.service.ts's
  // own comment on why this never goes negative on its own).
  if (input.lotId && (input.movementType === "consume" || input.movementType === "scrap" || input.movementType === "return")) {
    await consumeFromLot(db, tenantId, input.lotId, input.quantity);
  }

  await recomputeState(db, tenantId, itemId, performedBy);
  return { movement, totalBefore };
}

/**
 * Recomputes and persists an item's derived state from its real stock rows.
 * Only moves between in_stock/below_min/overstock/inactive — reorder_pending
 * and on_order are explicit Purchasing actions (markReorderPending/
 * markOnOrder below), never inferred here, so a stock check can't silently
 * undo a purchasing decision already in flight. Replenishing above min via
 * a real movement still clears reorder_pending/on_order back to in_stock.
 */
export async function recomputeState(db: TenantDb, tenantId: number, itemId: number, performedBy?: number): Promise<InventoryItem> {
  const [item] = await db.select().from(inventoryItems).where(and(eq(inventoryItems.id, itemId), eq(inventoryItems.tenantId, tenantId)));
  if (!item) throw AppError.notFound("InventoryItem");

  const stockRows = await getStockRows(db, tenantId, itemId);
  const onHand = stockRows.reduce((sum, r) => sum + Number(r.onHand), 0);
  const minLevel = Number(item.minLevel);
  const maxLevel = item.maxLevel === null ? null : Number(item.maxLevel);

  let newState: string;
  if (!item.active) {
    newState = "inactive";
  } else if (maxLevel !== null && onHand >= maxLevel) {
    newState = "overstock";
  } else if (onHand <= minLevel) {
    // Don't downgrade a purchasing decision already in flight.
    newState = item.state === "reorder_pending" || item.state === "on_order" ? item.state : "below_min";
  } else {
    newState = "in_stock";
  }

  if (newState === item.state) return item;

  const [updated] = await db.update(inventoryItems).set({ state: newState, updatedAt: new Date() }).where(eq(inventoryItems.id, itemId)).returning();

  await recordAuditTrail(db, {
    tenantId,
    entityType: "InventoryItem",
    entityId: itemId,
    action: "status_change",
    changes: { from: item.state, to: newState, onHand },
    performedBy,
  });
  await publishEvent(WORKFLOW_STREAM, { tenantId, module: "inventory", event: newState, entityId: itemId });

  if (newState === "below_min" || newState === "overstock") {
    await raiseAlertIfNeeded(db, tenantId, item, newState, onHand, minLevel);
  } else {
    // Auto-acknowledge whichever alert type this transition actually
    // resolved. Deliberately does NOT fire for reorder_pending/on_order —
    // those states mean "still below min, purchasing is already handling
    // it" (see this function's own below_min branch above), not "resolved".
    // Previously an alert stayed Open forever once raised, even long after
    // real stock recovered, until a human clicked Acknowledge by hand —
    // a deliberate product decision, not a bug fix reverted lightly. See
    // the QA sweep review.
    if (item.state === "below_min") await acknowledgeOpenAlerts(db, tenantId, itemId, "below_min", performedBy);
    if (item.state === "overstock") await acknowledgeOpenAlerts(db, tenantId, itemId, "overstock", performedBy);
  }

  return updated!;
}

async function acknowledgeOpenAlerts(db: TenantDb, tenantId: number, itemId: number, alertType: "below_min" | "overstock", performedBy: number | undefined) {
  const openAlerts = await db
    .select({ id: inventoryAlerts.id })
    .from(inventoryAlerts)
    .where(and(eq(inventoryAlerts.itemId, itemId), eq(inventoryAlerts.tenantId, tenantId), eq(inventoryAlerts.alertType, alertType), isNull(inventoryAlerts.acknowledgedAt)));
  if (openAlerts.length === 0) return;

  await db
    .update(inventoryAlerts)
    .set({ acknowledgedAt: new Date(), acknowledgedBy: performedBy })
    .where(and(eq(inventoryAlerts.itemId, itemId), eq(inventoryAlerts.tenantId, tenantId), eq(inventoryAlerts.alertType, alertType), isNull(inventoryAlerts.acknowledgedAt)));

  for (const alert of openAlerts) {
    await recordAuditTrail(db, {
      tenantId,
      entityType: "InventoryAlert",
      entityId: alert.id,
      action: "update",
      changes: { acknowledged: true, reason: "auto-resolved — stock recovered" },
      performedBy,
    });
  }
}

/**
 * Creates the ERP reorder stub row when Purchasing marks an item
 * reorder_pending — the only real trigger for that state (see
 * recomputeState's own comment); there is no automatic min/max-driven
 * creation, since min/max evaluation never sets reorder_pending itself.
 * requestedQty prefers the item's own reorderQuantity (the field that
 * already exists for exactly this), falling back to max_level - on_hand
 * (only meaningful when maxLevel is set) and finally min_level, so a
 * request never has to be a null/zero quantity.
 */
export async function createReorderRequest(db: TenantDb, tenantId: number, item: InventoryItem, onHand: number, createdBy: number | undefined) {
  const maxLevel = item.maxLevel === null ? null : Number(item.maxLevel);
  const target = item.reorderQuantity !== null ? Number(item.reorderQuantity) : maxLevel !== null ? Math.max(maxLevel - onHand, 0) : Number(item.minLevel);
  const requestedQty = Math.max(Math.round(target), 1);

  const [request] = await db.insert(inventoryReorderRequests).values({ tenantId, itemId: item.id, requestedQty, status: "pending", createdBy }).returning();
  await recordAuditTrail(db, {
    tenantId,
    entityType: "InventoryItem",
    entityId: item.id,
    action: "create",
    changes: { reorderRequestId: request!.id, requestedQty },
    performedBy: createdBy,
  });
  return request!;
}

async function raiseAlertIfNeeded(db: TenantDb, tenantId: number, item: InventoryItem, alertType: "below_min" | "overstock", onHand: number, minLevel: number) {
  const [openAlert] = await db
    .select()
    .from(inventoryAlerts)
    .where(and(eq(inventoryAlerts.itemId, item.id), eq(inventoryAlerts.tenantId, tenantId), eq(inventoryAlerts.alertType, alertType), isNull(inventoryAlerts.acknowledgedAt)));
  if (openAlert) return; // already an open, unacknowledged alert of this type — don't spam a second one

  await db.insert(inventoryAlerts).values({ tenantId, itemId: item.id, alertType, metadata: { onHand, minLevel } });

  if (alertType === "below_min") {
    const subject = `Inventory below minimum: ${item.sku}`;
    const body = `${item.sku} (${item.description ?? "no description"}) is at ${onHand} ${item.unitOfMeasure ?? "units"}, at or below its minimum of ${minLevel}. Suggested reorder quantity: ${item.reorderQuantity ?? "not set"}.`;
    await notifyDepartment(db, { tenantId, department: "material_management", subject, body, relatedEntityType: "InventoryItem", relatedEntityId: item.id });
    await notifyDepartment(db, { tenantId, department: "purchasing", subject, body, relatedEntityType: "InventoryItem", relatedEntityId: item.id });
  }
}

// ============================================================
// Settings → Inventory Module expansion: reservation logic
// ============================================================

/**
 * POST /inventory/items/:id/reserve. Blocks reserving past on-hand unless
 * inventorySettings.reservationRules.allowNegativeAllocation is on (a real
 * backorder-style allowance some tenants want, off by default).
 */
export async function reserveStock(db: TenantDb, tenantId: number, itemId: number, quantity: number, location: string | undefined, settings: InventorySettings | undefined, performedBy: number | undefined) {
  const loc = location ?? DEFAULT_LOCATION;
  const row = await getOrCreateStockRow(db, tenantId, itemId, loc);
  const nextAllocated = Number(row.allocated) + quantity;
  const unallocated = Number(row.onHand) - Number(row.allocated);

  if (!settings?.reservationRules?.allowNegativeAllocation && quantity > unallocated) {
    throw AppError.badRequest(`Cannot reserve ${quantity} — only ${unallocated} unallocated unit(s) at "${loc}" (reservationRules.allowNegativeAllocation is off).`);
  }

  await db.update(inventoryStock).set({ allocated: String(nextAllocated), allocatedAt: new Date() }).where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.tenantId, tenantId), eq(inventoryStock.location, loc)));
  await recordAuditTrail(db, { tenantId, entityType: "InventoryItem", entityId: itemId, action: "update", changes: { reserve: quantity, location: loc, newAllocated: nextAllocated }, performedBy });
  return getStockRows(db, tenantId, itemId);
}

/** POST /inventory/items/:id/release — the inverse of reserveStock; never goes negative. */
export async function releaseStock(db: TenantDb, tenantId: number, itemId: number, quantity: number, location: string | undefined, performedBy: number | undefined) {
  const loc = location ?? DEFAULT_LOCATION;
  const row = await getOrCreateStockRow(db, tenantId, itemId, loc);
  const nextAllocated = Math.max(Number(row.allocated) - quantity, 0);

  await db.update(inventoryStock).set({ allocated: String(nextAllocated), allocatedAt: nextAllocated > 0 ? new Date() : null }).where(and(eq(inventoryStock.itemId, itemId), eq(inventoryStock.tenantId, tenantId), eq(inventoryStock.location, loc)));
  await recordAuditTrail(db, { tenantId, entityType: "InventoryItem", entityId: itemId, action: "update", changes: { release: quantity, location: loc, newAllocated: nextAllocated }, performedBy });
  return getStockRows(db, tenantId, itemId);
}

/**
 * Lazily expires a stale reservation the next time this item's stock is
 * actually viewed (GET /inventory/items/:id) — there is no background
 * scheduler in this app (same limitation as the AI usage monthly-limit
 * computation and the ERP Sync engine's own `schedule` field), so
 * reservationRules.autoReleaseAfterDays is enforced at read time rather than
 * by a timer. Only called from getItemHandler, not every getStockRows caller
 * — see that handler's own comment.
 */
export async function applyReservationAutoRelease(db: TenantDb, tenantId: number, itemId: number, settings: InventorySettings | undefined) {
  const days = settings?.reservationRules?.autoReleaseAfterDays;
  if (!days) return;

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const rows = await getStockRows(db, tenantId, itemId);
  for (const row of rows) {
    if (Number(row.allocated) > 0 && row.allocatedAt && row.allocatedAt.getTime() < cutoff) {
      await db.update(inventoryStock).set({ allocated: "0", allocatedAt: null }).where(eq(inventoryStock.id, row.id));
      await recordAuditTrail(db, {
        tenantId,
        entityType: "InventoryItem",
        entityId: itemId,
        action: "update",
        changes: { autoReleased: true, previouslyAllocated: row.allocated, location: row.location, afterDays: days },
        performedBy: undefined,
      });
    }
  }
}

// ============================================================
// Settings → Inventory Module expansion: aging + cycle count
// ============================================================

export type AgingBucket = "fresh" | "warning" | "critical";

/** Days since the item's stock was last touched (lastAdjustedAt across every location, falling back to the item's own createdAt when it's never had a movement). */
export function computeAgingBucket(daysSinceActivity: number | null, agingRules: InventorySettings["agingRules"] | undefined): AgingBucket | null {
  if (daysSinceActivity === null || !agingRules) return null;
  if (agingRules.criticalDays !== undefined && daysSinceActivity >= agingRules.criticalDays) return "critical";
  if (agingRules.warningDays !== undefined && daysSinceActivity >= agingRules.warningDays) return "warning";
  return "fresh";
}

/** Whether this item is due (or overdue) for a cycle count per inventorySettings.auditFrequency — null lastCountedAt (never counted) always reads as due. */
export function isCycleCountDue(lastCountedAt: Date | null, auditFrequency: InventorySettings["auditFrequency"] | undefined): boolean {
  if (!auditFrequency) return false; // no frequency configured — not tracked at all, same "honest, not fabricated" convention as everywhere else in this module
  if (!lastCountedAt) return true;
  const intervalDays = { daily: 1, weekly: 7, monthly: 30, quarterly: 90 }[auditFrequency];
  const dueAt = lastCountedAt.getTime() + intervalDays * 24 * 60 * 60 * 1000;
  return Date.now() >= dueAt;
}
