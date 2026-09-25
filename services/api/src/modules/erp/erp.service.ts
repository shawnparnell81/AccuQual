import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import {
  erpPurchaseOrders,
  erpPoLineItems,
  erpReceivingDocuments,
  erpReceivingLineItems,
  erpPurchaseRequisitions,
  type ErpPurchaseOrder,
  type ErpPurchaseRequisition,
} from "../../drizzle/schema/erp.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { applyMovement } from "../inventory/inventory.service.js";
import { receiveIntoLot } from "../inventory/inventoryLots.service.js";
import { loadCompanyForSettings, getInventorySettings } from "../settings/settings.service.js";

export interface LineItemInput {
  itemId: number;
  quantity: number;
  unitCost?: number;
  notes?: string;
}

/** Every request here already runs inside one Postgres transaction (see tenantScope.ts's withDb) — no separate db.transaction() needed for these multi-insert operations to be atomic. */
export async function createPurchaseOrder(
  db: Db,
  supplierId: number,
  lineItems: LineItemInput[],
  notes: string | undefined,
  createdBy: number | undefined,
  expectedDeliveryDate?: string
) {
  const [po] = await db
    .insert(erpPurchaseOrders)
    .values({ supplierId, notes, createdBy, status: "draft", expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : undefined })
    .returning();
  await insertLineItems(db, po!.id, lineItems);
  await recordAuditTrail(db, { entityType: "PurchaseOrder", entityId: po!.id, action: "create", changes: { supplierId, lineItemCount: lineItems.length }, performedBy: createdBy });
  return po!;
}

async function insertLineItems(db: Db, purchaseOrderId: number, lineItems: LineItemInput[]) {
  await db.insert(erpPoLineItems).values(
    lineItems.map((li) => ({
      purchaseOrderId,
      itemId: li.itemId,
      quantity: li.quantity,
      unitCost: li.unitCost !== undefined ? String(li.unitCost) : undefined,
      notes: li.notes,
    }))
  );
}

export async function replaceLineItems(db: Db, po: ErpPurchaseOrder, lineItems: LineItemInput[], performedBy: number | undefined) {
  if (po.status !== "draft") throw AppError.badRequest(`Cannot edit line items — purchase order is "${po.status}", not "draft"`);
  await db.delete(erpPoLineItems).where(and(eq(erpPoLineItems.purchaseOrderId, po.id)));
  await insertLineItems(db, po.id, lineItems);
  await recordAuditTrail(db, { entityType: "PurchaseOrder", entityId: po.id, action: "update", changes: { lineItemCount: lineItems.length }, performedBy });
}

export async function getLineItems(db: Db, purchaseOrderId: number) {
  return db.select().from(erpPoLineItems).where(and(eq(erpPoLineItems.purchaseOrderId, purchaseOrderId)));
}

/** Sum of quantityReceived per PO line item, across every receiving document filed against this PO — real received totals, not the PO's own guess. */
export async function getReceivedQuantities(db: Db, poLineItemIds: number[]): Promise<Map<number, number>> {
  if (poLineItemIds.length === 0) return new Map();
  const rows = await db.select().from(erpReceivingLineItems).where(and(inArray(erpReceivingLineItems.poLineItemId, poLineItemIds)));
  const totals = new Map<number, number>();
  for (const r of rows) totals.set(r.poLineItemId, (totals.get(r.poLineItemId) ?? 0) + r.quantityReceived);
  return totals;
}

export async function sendPurchaseOrder(db: Db, po: ErpPurchaseOrder, performedBy: number | undefined) {
  if (po.status !== "draft") throw AppError.badRequest(`Cannot send — purchase order is "${po.status}", not "draft"`);
  const lineItems = await getLineItems(db, po.id);
  if (lineItems.length === 0) throw AppError.badRequest("Cannot send a purchase order with no line items");

  const [updated] = await db.update(erpPurchaseOrders).set({ status: "sent", updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, po.id)).returning();
  await recordAuditTrail(db, { entityType: "PurchaseOrder", entityId: po.id, action: "status_change", changes: { from: "draft", to: "sent" }, performedBy });
  return updated!;
}

export async function cancelPurchaseOrder(db: Db, po: ErpPurchaseOrder, performedBy: number | undefined) {
  if (po.status === "received" || po.status === "cancelled") {
    throw AppError.badRequest(`Cannot cancel — purchase order is already "${po.status}"`);
  }
  const [updated] = await db.update(erpPurchaseOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, po.id)).returning();
  await recordAuditTrail(db, { entityType: "PurchaseOrder", entityId: po.id, action: "status_change", changes: { from: po.status, to: "cancelled" }, performedBy });
  return updated!;
}

/**
 * Creates a receiving document + its line items, then recomputes the PO's
 * status from real received-vs-ordered totals across every receiving
 * document ever filed against it (not just this one) — partially_received
 * if some but not all lines are fully received, received once every line
 * is.
 *
 * Phase 8 — previously did NOT touch inventory_stock or create an
 * inventory_movement at all ("receiving here is real paperwork, not a live
 * integration" — the single biggest gap in the whole module, since it left
 * the "receiving → inventory → production → NCR → CAPA → warranty"
 * traceability chain with no first link). Now applies a real "receive"
 * movement per line against the PO line's underlying inventory item, and —
 * when a lot number is given — creates/updates a real inventory_lots row
 * via receiveIntoLot, linking the movement to it. Each new receiving line
 * item starts life in the new structured workflow at status "received"
 * (see erp.ts's schema comment) — moving it to pending_inspection/
 * inspected/accepted/rejected/quarantined/disposition_required is a
 * separate, later action (receivingWorkflow.ts's transitionReceivingLineItem),
 * not something this create step decides on its own.
 */
export async function createReceivingDocument(
  db: Db,
  po: ErpPurchaseOrder,
  lineItems: { poLineItemId: number; quantityReceived: number; notes?: string; lotNumber?: string; serialNumber?: string; revisionLevel?: string; expirationDate?: string }[],
  notes: string | undefined,
  createdBy: number | undefined
) {
  if (po.status !== "sent" && po.status !== "partially_received") {
    throw AppError.badRequest(`Cannot receive against a purchase order that is "${po.status}"`);
  }

  const poLineItems = await getLineItems(db, po.id);
  const poLineItemById = new Map(poLineItems.map((li) => [li.id, li]));
  for (const li of lineItems) {
    if (!poLineItemById.has(li.poLineItemId)) throw AppError.badRequest(`Line item ${li.poLineItemId} does not belong to this purchase order`);
  }

  const [doc] = await db.insert(erpReceivingDocuments).values({ purchaseOrderId: po.id, notes, createdBy }).returning();
  const createdLines = await db
    .insert(erpReceivingLineItems)
    .values(
      lineItems.map((li) => ({
        receivingDocumentId: doc!.id,
        poLineItemId: li.poLineItemId,
        quantityReceived: li.quantityReceived,
        notes: li.notes,
        lotNumber: li.lotNumber,
        serialNumber: li.serialNumber,
      }))
    )
    .returning();
  await recordAuditTrail(db, {
    entityType: "ReceivingDocument",
    entityId: doc!.id,
    action: "create",
    changes: { purchaseOrderId: po.id, lineItemCount: lineItems.length },
    performedBy: createdBy,
  });

  const co = await loadCompanyForSettings(db);
  const inventorySettings = getInventorySettings(co);
  for (const created of createdLines) {
    const poLine = poLineItemById.get(created.poLineItemId)!;
    const input = lineItems.find((li) => li.poLineItemId === created.poLineItemId)!;

    let lotId: number | undefined;
    if (input.lotNumber) {
      const lot = await receiveIntoLot(db, {
        itemId: poLine.itemId,
        lotNumber: input.lotNumber,
        serialNumber: input.serialNumber,
        supplierId: po.supplierId,
        purchaseOrderId: po.id,
        receivingLineItemId: created.id,
        revisionLevel: input.revisionLevel,
        expirationDate: input.expirationDate ? new Date(input.expirationDate) : undefined,
        quantity: created.quantityReceived,
      });
      lotId = lot.id;
    }

    await applyMovement(
      db,
      poLine.itemId,
      {
        movementType: "receive",
        quantity: created.quantityReceived,
        referenceType: "erp_receiving",
        referenceId: String(doc!.id),
        lotNumber: input.lotNumber,
        serialNumber: input.serialNumber,
        lotId,
      },
      createdBy,
      inventorySettings
    );
  }

  const receivedTotals = await getReceivedQuantities(db, poLineItems.map((li) => li.id));
  const fullyReceived = poLineItems.every((li) => (receivedTotals.get(li.id) ?? 0) >= li.quantity);
  const anyReceived = poLineItems.some((li) => (receivedTotals.get(li.id) ?? 0) > 0);
  const newStatus = fullyReceived ? "received" : anyReceived ? "partially_received" : po.status;

  if (newStatus !== po.status) {
    await db.update(erpPurchaseOrders).set({ status: newStatus, updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, po.id));
  }

  await recordAuditTrail(db, {
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "status_change",
    changes: { receivingDocumentId: doc!.id, from: po.status, to: newStatus },
    performedBy: createdBy,
  });

  return doc!;
}

const REQUISITION_ALLOWED_NEXT: Record<string, string[]> = {
  draft: ["pending_approval"],
  pending_approval: ["approved", "rejected"],
  approved: ["converted_to_po"],
  rejected: [],
  converted_to_po: [],
};

async function transitionRequisition(db: Db, req: ErpPurchaseRequisition, newStatus: string, performedBy: number | undefined, patch: Record<string, unknown> = {}) {
  if (!REQUISITION_ALLOWED_NEXT[req.status]?.includes(newStatus)) {
    throw AppError.badRequest(`Cannot move a requisition from "${req.status}" to "${newStatus}"`);
  }
  const [updated] = await db
    .update(erpPurchaseRequisitions)
    .set({ status: newStatus, updatedAt: new Date(), ...patch })
    .where(eq(erpPurchaseRequisitions.id, req.id))
    .returning();
  await recordAuditTrail(db, {
    entityType: "PurchaseRequisition",
    entityId: req.id,
    action: "status_change",
    changes: { oldStatus: req.status, newStatus },
    performedBy,
  });
  return updated!;
}

export async function submitRequisition(db: Db, req: ErpPurchaseRequisition, performedBy: number | undefined) {
  return transitionRequisition(db, req, "pending_approval", performedBy);
}

export async function approveRequisition(db: Db, req: ErpPurchaseRequisition, performedBy: number | undefined) {
  return transitionRequisition(db, req, "approved", performedBy, { approvedBy: performedBy, approvedAt: new Date() });
}

export async function rejectRequisition(db: Db, req: ErpPurchaseRequisition, performedBy: number | undefined) {
  return transitionRequisition(db, req, "rejected", performedBy);
}

/**
 * Converts an approved requisition into a real Purchase Order — the one
 * real write this feature was built for. Reuses createPurchaseOrder above
 * rather than inserting erp_purchase_orders directly, so a converted
 * requisition's PO is created through the exact same path (and gets the
 * exact same "PurchaseOrder create" audit entry) as one entered by hand.
 * requisition.supplierId is required at this point — validated in
 * erp.controller.ts's convertRequisitionToPoHandler, not here, since a
 * requisition may legitimately be created without one and have it filled
 * in during approval.
 */
export async function convertRequisitionToPo(db: Db, requisition: ErpPurchaseRequisition, performedBy: number | undefined) {
  if (requisition.status !== "approved") {
    throw AppError.badRequest(`Cannot convert — requisition is "${requisition.status}", not "approved"`);
  }
  if (requisition.supplierId === null) {
    throw AppError.badRequest("Requisition has no supplier set — set one before converting to a Purchase Order");
  }

  const po = await createPurchaseOrder(
    db,
    requisition.supplierId,
    [{ itemId: requisition.itemId, quantity: requisition.quantity }],
    `Created from Purchase Requisition #${requisition.id}`,
    performedBy
  );

  const updated = await transitionRequisition(db, requisition, "converted_to_po", performedBy, { purchaseOrderId: po.id });
  return { requisition: updated, purchaseOrder: po };
}
