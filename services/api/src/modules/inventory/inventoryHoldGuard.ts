import { and, eq } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { inventoryLots } from "../../drizzle/schema/inventoryLots.js";
import { AppError } from "../../utils/appError.js";

/**
 * The check that makes a quarantine hold real. Units on hold (inventory_items.held_qty / inventory_lots.held_qty, written only by
 * inventoryHolds.service.ts) can never be issued, consumed, scrapped, returned or reserved through the inventory system:
 * on-hand may not drop below what is held. Kept in its own file with no imports from the rest of inventory so anything that moves
 * or reserves stock can call it without a circular dependency.
 */

/** Units of an item currently held (0 when none). */
export async function heldUnits(db: TenantDb, itemId: number): Promise<number> {
  const [item] = await db.select({ held: inventoryItems.heldQty }).from(inventoryItems).where(and(eq(inventoryItems.id, itemId)));
  return Number(item?.held ?? 0);
}

/**
 * Throws 409 when taking `quantity` out of an item that has `totalOnHand` in stock would touch held units. When a lot is named, that
 * lot's own held units are protected too, so releasing one lot's hold never frees another's.
 */
export async function assertNotHeld(db: TenantDb, itemId: number, quantity: number, totalOnHand: number, lotId?: number): Promise<void> {
  const held = await heldUnits(db, itemId);
  if (held > 0 && totalOnHand - quantity < held) {
    const usable = Math.max(totalOnHand - held, 0);
    throw new AppError(`Only ${usable} of the ${totalOnHand} unit(s) on hand can be used: ${held} ${held === 1 ? "is" : "are"} on quarantine hold. Release or destroy the hold in Quarantine first.`, 409);
  }
  if (lotId !== undefined) {
    const [lot] = await db.select({ lotNumber: inventoryLots.lotNumber, remaining: inventoryLots.remainingQty, held: inventoryLots.heldQty }).from(inventoryLots).where(and(eq(inventoryLots.id, lotId)));
    if (lot && Number(lot.held) > 0 && Number(lot.remaining) - Number(lot.held) < quantity) {
      throw new AppError(`Lot ${lot.lotNumber} has ${Number(lot.held)} unit(s) on quarantine hold; only ${Math.max(Number(lot.remaining) - Number(lot.held), 0)} can be used. Release or destroy the hold in Quarantine first.`, 409);
    }
  }
}
