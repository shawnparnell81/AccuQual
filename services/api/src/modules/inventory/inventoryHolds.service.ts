import { and, desc, eq } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { inventoryItems, inventoryStock } from "../../drizzle/schema/inventory.js";
import { inventoryLots } from "../../drizzle/schema/inventoryLots.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { applyMovement } from "./inventory.service.js";

/**
 * The inventory side of a quarantine hold. The quarantine module decides WHAT is held and why; this file is the only place the two
 * held-quantity counters change, and applyMovement / reserveStock / consumeFromLot refuse to go below them (inventoryHoldGuard.ts).
 */

export interface HoldTarget {
  itemId: number;
  /** Set when the hold is on one lot; unset for an item not tracked by lot. */
  lotId?: number;
}

export async function stockTotal(db: TenantDb, itemId: number): Promise<number> {
  const rows = await db.select().from(inventoryStock).where(and(eq(inventoryStock.itemId, itemId)));
  return rows.reduce((sum, r) => sum + Number(r.onHand), 0);
}

/** Units of a lot / item that could still be put on hold: not already held (and, for a lot, not already used). */
export async function holdableUnits(db: TenantDb, target: HoldTarget): Promise<number> {
  const [item] = await db.select({ held: inventoryItems.heldQty }).from(inventoryItems).where(and(eq(inventoryItems.id, target.itemId)));
  if (!item) throw AppError.notFound("Inventory item");
  const itemAvailable = (await stockTotal(db, target.itemId)) - Number(item.held);
  if (target.lotId === undefined) return Math.max(itemAvailable, 0);
  const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.id, target.lotId)));
  if (!lot) throw AppError.notFound("Inventory lot");
  return Math.max(Math.min(Number(lot.remainingQty) - Number(lot.heldQty), itemAvailable), 0);
}

async function bump(db: TenantDb, target: HoldTarget, delta: number) {
  const [item] = await db.select({ held: inventoryItems.heldQty }).from(inventoryItems).where(and(eq(inventoryItems.id, target.itemId)));
  if (!item) throw AppError.notFound("Inventory item");
  await db.update(inventoryItems).set({ heldQty: String(Math.max(Number(item.held) + delta, 0)) }).where(and(eq(inventoryItems.id, target.itemId)));
  if (target.lotId !== undefined) {
    const [lot] = await db.select({ held: inventoryLots.heldQty }).from(inventoryLots).where(and(eq(inventoryLots.id, target.lotId)));
    if (!lot) throw AppError.notFound("Inventory lot");
    await db.update(inventoryLots).set({ heldQty: String(Math.max(Number(lot.held) + delta, 0)) }).where(and(eq(inventoryLots.id, target.lotId)));
  }
}

/** Puts `quantity` units on hold. Refuses if that many aren't available to hold. */
export async function placeHold(db: TenantDb, target: HoldTarget, quantity: number, context: { quarantineId: number }, performedBy?: number): Promise<void> {
  const available = await holdableUnits(db, target);
  if (quantity > available) throw AppError.badRequest(`Only ${available} unit(s) can be put on hold${target.lotId !== undefined ? " from that lot" : ""} (the rest are already held or used).`);
  await bump(db, target, quantity);
  await recordAuditTrail(db, { entityType: "InventoryItem", entityId: target.itemId, action: "update", changes: { event: "quarantine_hold_placed", quantity, lotId: target.lotId, quarantineId: context.quarantineId }, performedBy });
}

/** Lifts a hold on `quantity` units (they become usable again). Never goes below zero. */
export async function liftHold(db: TenantDb, target: HoldTarget, quantity: number, context: { quarantineId: number; reason: string }, performedBy?: number): Promise<void> {
  await bump(db, target, -quantity);
  await recordAuditTrail(db, { entityType: "InventoryItem", entityId: target.itemId, action: "update", changes: { event: "quarantine_hold_lifted", quantity, lotId: target.lotId, quarantineId: context.quarantineId, reason: context.reason }, performedBy });
}

/**
 * Removes held units from stock (a destroy / return-to-supplier decision): the hold is lifted and the same units leave inventory as a
 * scrap or return movement, in one step, so held stock can never be removed except through a recorded quarantine decision. Units are
 * taken from the locations with the most stock first.
 */
export async function removeHeldStock(db: TenantDb, target: HoldTarget, quantity: number, opts: { movementType: "scrap" | "return"; reason: string; quarantineId: number }, performedBy?: number): Promise<void> {
  await liftHold(db, target, quantity, { quarantineId: opts.quarantineId, reason: opts.reason }, performedBy);
  const rows = (await db.select().from(inventoryStock).where(and(eq(inventoryStock.itemId, target.itemId))).orderBy(desc(inventoryStock.onHand))).filter((r) => Number(r.onHand) > 0);
  let remaining = quantity;
  for (const row of rows) {
    if (remaining <= 0) break;
    const take = Math.min(Number(row.onHand), remaining);
    await applyMovement(db, target.itemId, { movementType: opts.movementType, quantity: take, fromLocation: row.location, reason: opts.reason, referenceType: "quarantine", referenceId: String(opts.quarantineId), lotId: target.lotId }, performedBy);
    remaining -= take;
  }
  if (remaining > 0) throw AppError.badRequest(`Only ${quantity - remaining} of the ${quantity} unit(s) are in stock to remove.`);
}
