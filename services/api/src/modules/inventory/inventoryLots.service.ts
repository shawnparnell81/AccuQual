import { and, eq, desc } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { inventoryLots, type InventoryLot } from "../../drizzle/schema/inventoryLots.js";
import { inventoryItems, inventoryMovements } from "../../drizzle/schema/inventory.js";
import { erpReceivingLineItems, erpPoLineItems, erpPurchaseOrders } from "../../drizzle/schema/erp.js";
import { qualityInspectionReports } from "../../drizzle/schema/qualityInspectionReports.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { AppError } from "../../utils/appError.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";

export interface ReceiveLotInput {
  itemId: number;
  lotNumber: string;
  serialNumber?: string;
  supplierId?: number;
  purchaseOrderId?: number;
  receivingLineItemId?: number;
  revisionLevel?: string;
  expirationDate?: Date;
  quantity: number;
}

/**
 * The one real per-lot ledger write path — called from erp.service.ts's
 * createReceivingDocument (see that file's own comment) whenever a
 * receiving line item carries a lot number. Upserts by (itemId,
 * lotNumber): a second receipt against the SAME lot number (a real case —
 * a partial shipment split across two receiving documents) adds to the
 * existing lot's received/remaining quantity rather than creating a
 * confusing second row for the same physical lot.
 */
export async function receiveIntoLot(db: Db, input: ReceiveLotInput): Promise<InventoryLot> {
  const [existing] = await db
    .select()
    .from(inventoryLots)
    .where(and(eq(inventoryLots.itemId, input.itemId), eq(inventoryLots.lotNumber, input.lotNumber)));

  if (existing) {
    const [updated] = await db
      .update(inventoryLots)
      .set({
        receivedQty: String(Number(existing.receivedQty) + input.quantity),
        remainingQty: String(Number(existing.remainingQty) + input.quantity),
        status: "active",
        // A later receipt's own supplier/PO/revision/expiration wins if
        // this lot didn't already have one set — never silently overwrites
        // a value a prior receipt already recorded.
        supplierId: existing.supplierId ?? input.supplierId,
        purchaseOrderId: existing.purchaseOrderId ?? input.purchaseOrderId,
        receivingLineItemId: existing.receivingLineItemId ?? input.receivingLineItemId,
        revisionLevel: existing.revisionLevel ?? input.revisionLevel,
        expirationDate: existing.expirationDate ?? input.expirationDate,
      })
      .where(eq(inventoryLots.id, existing.id))
      .returning();
    // Sprint 3 (accuqual-implementation-sequencing.md) — Inventory
    // Traceability had zero Layer-2 event coverage before this (the lot
    // ledger itself never published anything a workflow definition could
    // react to). Additive only — the receiving logic above is unchanged.
    // Same "module: inventory" convention inventory.service.ts's own
    // state-change events already use, new event name for the lot-specific
    // hop.
    await publishEvent(WORKFLOW_STREAM, { module: "inventory", event: "lot-received", entityId: updated!.id });
    return updated!;
  }

  const [created] = await db
    .insert(inventoryLots)
    .values({
      itemId: input.itemId,
      lotNumber: input.lotNumber,
      serialNumber: input.serialNumber,
      supplierId: input.supplierId,
      purchaseOrderId: input.purchaseOrderId,
      receivingLineItemId: input.receivingLineItemId,
      revisionLevel: input.revisionLevel,
      expirationDate: input.expirationDate,
      receivedQty: String(input.quantity),
      remainingQty: String(input.quantity),
    })
    .returning();
  await publishEvent(WORKFLOW_STREAM, { module: "inventory", event: "lot-received", entityId: created!.id });
  return created!;
}

/**
 * Decrements a lot's remaining quantity for an outbound movement (consume/
 * scrap/transfer-out/return) — called from inventory.service.ts's
 * applyMovement whenever the caller supplied a real lotId. Never goes
 * negative (clamped, same "insufficient stock" spirit as setOnHand, but a
 * lot-quantity mismatch is logged as a warning rather than blocking the
 * movement — the underlying inventory_stock on-hand check is still the
 * real gate on whether this movement is allowed at all).
 */
export async function consumeFromLot(db: Db, lotId: number, quantity: number): Promise<void> {
  const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.id, lotId)));
  if (!lot) throw AppError.badRequest(`Lot #${lotId} not found`);
  // Second layer behind applyMovement's own check: never draw down units that are on quarantine hold.
  if (Number(lot.heldQty) > 0 && Number(lot.remainingQty) - Number(lot.heldQty) < quantity) {
    throw new AppError(`Lot ${lot.lotNumber} has ${Number(lot.heldQty)} unit(s) on quarantine hold; only ${Math.max(Number(lot.remainingQty) - Number(lot.heldQty), 0)} can be used.`, 409);
  }

  const nextRemaining = Math.max(Number(lot.remainingQty) - quantity, 0);
  const nextStatus = nextRemaining === 0 ? "consumed" : lot.status;
  await db.update(inventoryLots).set({ remainingQty: String(nextRemaining), status: nextStatus }).where(eq(inventoryLots.id, lotId));
  // Sprint 3 — the movement side of the same lot-ledger event gap; fires
  // "lot-exhausted" specifically when this consumption fully depletes the
  // lot (its own real, distinct state change), and "lot-consumed" for every
  // other partial draw, so a workflow definition can distinguish the two
  // without re-deriving remainingQty itself.
  await publishEvent(WORKFLOW_STREAM, { module: "inventory", event: nextStatus === "consumed" ? "lot-exhausted" : "lot-consumed", entityId: lotId });
}

export async function getItemLots(db: Db, itemId: number): Promise<InventoryLot[]> {
  return db.select().from(inventoryLots).where(and(eq(inventoryLots.itemId, itemId))).orderBy(desc(inventoryLots.createdAt));
}

async function loadLot(db: Db, lotId: number): Promise<InventoryLot> {
  const [lot] = await db.select().from(inventoryLots).where(and(eq(inventoryLots.id, lotId)));
  if (!lot) throw AppError.notFound("InventoryLot");
  return lot;
}

/**
 * The real "receiving → inventory → production → NCR/CAPA/warranty"
 * traceability chain (Phase 8 task 4) — one call assembling the item this
 * lot belongs to, its full backward chain (receiving line item → PO line →
 * PO → supplier → inspection report, when each link exists), plus its
 * forward movement history. NCR/CAPA/warranty are NOT joined here: they
 * link back to a receiving line item (ncr.receivingLineItemId) or a
 * supplier, not to a specific lot — the receiving-line-item id this returns
 * is what a caller cross-references against `GET /ncr?receivingLineItemId=`
 * to complete the chain, keeping this query from having to know about every
 * downstream module.
 */
export async function getLotTraceability(db: Db, lotId: number) {
  const lot = await loadLot(db, lotId);

  const [movements, receivingLine, supplier, [item]] = await Promise.all([
    db.select().from(inventoryMovements).where(and(eq(inventoryMovements.lotId, lotId))).orderBy(desc(inventoryMovements.performedAt)),
    lot.receivingLineItemId
      ? db
          .select({
            id: erpReceivingLineItems.id,
            status: erpReceivingLineItems.status,
            quantityReceived: erpReceivingLineItems.quantityReceived,
            poLineItemId: erpReceivingLineItems.poLineItemId,
          })
          .from(erpReceivingLineItems)
          .where(and(eq(erpReceivingLineItems.id, lot.receivingLineItemId)))
      : Promise.resolve([]),
    lot.supplierId ? db.select({ id: suppliers.id, name: suppliers.name }).from(suppliers).where(eq(suppliers.id, lot.supplierId)) : Promise.resolve([]),
    db.select({ id: inventoryItems.id, sku: inventoryItems.sku, description: inventoryItems.description, itemType: inventoryItems.itemType }).from(inventoryItems).where(and(eq(inventoryItems.id, lot.itemId))),
  ]);

  const receivingLineItem = receivingLine[0];
  let poLineItem = null;
  let purchaseOrder = null;
  let inspectionReport = null;
  if (receivingLineItem) {
    const [poLine] = await db.select().from(erpPoLineItems).where(and(eq(erpPoLineItems.id, receivingLineItem.poLineItemId)));
    poLineItem = poLine ?? null;
    if (poLine) {
      const [po] = await db.select().from(erpPurchaseOrders).where(and(eq(erpPurchaseOrders.id, poLine.purchaseOrderId)));
      purchaseOrder = po ?? null;
    }
    const [report] = await db
      .select()
      .from(qualityInspectionReports)
      .where(and(eq(qualityInspectionReports.receivingLineItemId, receivingLineItem.id)));
    inspectionReport = report ?? null;
  }

  return { lot, item, supplier: supplier[0] ?? null, receivingLineItem: receivingLineItem ?? null, poLineItem, purchaseOrder, inspectionReport, movements };
}
