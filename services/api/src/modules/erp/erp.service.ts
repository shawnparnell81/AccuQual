import { and, eq, inArray } from "drizzle-orm";
import type { TenantDb } from "../../lib/tenantScope.js";
import { erpPurchaseOrders, erpPoLineItems, erpReceivingDocuments, erpReceivingLineItems, type ErpPurchaseOrder } from "../../drizzle/schema/erp.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

export interface LineItemInput {
  itemId: number;
  quantity: number;
  unitCost?: number;
  notes?: string;
}

/** Every request here already runs inside one Postgres transaction (see tenantScope.ts's withTenantDb) — no separate db.transaction() needed for these multi-insert operations to be atomic. */
export async function createPurchaseOrder(db: TenantDb, tenantId: number, supplierId: number, lineItems: LineItemInput[], notes: string | undefined, createdBy: number | undefined) {
  const [po] = await db.insert(erpPurchaseOrders).values({ tenantId, supplierId, notes, createdBy, status: "draft" }).returning();
  await insertLineItems(db, tenantId, po!.id, lineItems);
  await recordAuditTrail(db, { tenantId, entityType: "PurchaseOrder", entityId: po!.id, action: "create", changes: { supplierId, lineItemCount: lineItems.length }, performedBy: createdBy });
  return po!;
}

async function insertLineItems(db: TenantDb, tenantId: number, purchaseOrderId: number, lineItems: LineItemInput[]) {
  await db.insert(erpPoLineItems).values(
    lineItems.map((li) => ({
      tenantId,
      purchaseOrderId,
      itemId: li.itemId,
      quantity: li.quantity,
      unitCost: li.unitCost !== undefined ? String(li.unitCost) : undefined,
      notes: li.notes,
    }))
  );
}

export async function replaceLineItems(db: TenantDb, tenantId: number, po: ErpPurchaseOrder, lineItems: LineItemInput[], performedBy: number | undefined) {
  if (po.status !== "draft") throw AppError.badRequest(`Cannot edit line items — purchase order is "${po.status}", not "draft"`);
  await db.delete(erpPoLineItems).where(and(eq(erpPoLineItems.purchaseOrderId, po.id), eq(erpPoLineItems.tenantId, tenantId)));
  await insertLineItems(db, tenantId, po.id, lineItems);
  await recordAuditTrail(db, { tenantId, entityType: "PurchaseOrder", entityId: po.id, action: "update", changes: { lineItemCount: lineItems.length }, performedBy });
}

export async function getLineItems(db: TenantDb, tenantId: number, purchaseOrderId: number) {
  return db.select().from(erpPoLineItems).where(and(eq(erpPoLineItems.purchaseOrderId, purchaseOrderId), eq(erpPoLineItems.tenantId, tenantId)));
}

/** Sum of quantityReceived per PO line item, across every receiving document filed against this PO — real received totals, not the PO's own guess. */
export async function getReceivedQuantities(db: TenantDb, tenantId: number, poLineItemIds: number[]): Promise<Map<number, number>> {
  if (poLineItemIds.length === 0) return new Map();
  const rows = await db.select().from(erpReceivingLineItems).where(and(eq(erpReceivingLineItems.tenantId, tenantId), inArray(erpReceivingLineItems.poLineItemId, poLineItemIds)));
  const totals = new Map<number, number>();
  for (const r of rows) totals.set(r.poLineItemId, (totals.get(r.poLineItemId) ?? 0) + r.quantityReceived);
  return totals;
}

export async function sendPurchaseOrder(db: TenantDb, tenantId: number, po: ErpPurchaseOrder, performedBy: number | undefined) {
  if (po.status !== "draft") throw AppError.badRequest(`Cannot send — purchase order is "${po.status}", not "draft"`);
  const lineItems = await getLineItems(db, tenantId, po.id);
  if (lineItems.length === 0) throw AppError.badRequest("Cannot send a purchase order with no line items");

  const [updated] = await db.update(erpPurchaseOrders).set({ status: "sent", updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, po.id)).returning();
  await recordAuditTrail(db, { tenantId, entityType: "PurchaseOrder", entityId: po.id, action: "status_change", changes: { from: "draft", to: "sent" }, performedBy });
  return updated!;
}

export async function cancelPurchaseOrder(db: TenantDb, tenantId: number, po: ErpPurchaseOrder, performedBy: number | undefined) {
  if (po.status === "received" || po.status === "cancelled") {
    throw AppError.badRequest(`Cannot cancel — purchase order is already "${po.status}"`);
  }
  const [updated] = await db.update(erpPurchaseOrders).set({ status: "cancelled", updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, po.id)).returning();
  await recordAuditTrail(db, { tenantId, entityType: "PurchaseOrder", entityId: po.id, action: "status_change", changes: { from: po.status, to: "cancelled" }, performedBy });
  return updated!;
}

/**
 * Creates a receiving document + its line items, then recomputes the PO's
 * status from real received-vs-ordered totals across every receiving
 * document ever filed against it (not just this one) — partially_received
 * if some but not all lines are fully received, received once every line
 * is. Deliberately does NOT touch inventory_stock or create an
 * inventory_movement — no automatic inventory sync exists (see the ERP
 * module review); receiving here is real paperwork, not a live integration.
 */
export async function createReceivingDocument(
  db: TenantDb,
  tenantId: number,
  po: ErpPurchaseOrder,
  lineItems: { poLineItemId: number; quantityReceived: number; notes?: string }[],
  notes: string | undefined,
  createdBy: number | undefined
) {
  if (po.status !== "sent" && po.status !== "partially_received") {
    throw AppError.badRequest(`Cannot receive against a purchase order that is "${po.status}"`);
  }

  const poLineItems = await getLineItems(db, tenantId, po.id);
  const poLineItemIds = new Set(poLineItems.map((li) => li.id));
  for (const li of lineItems) {
    if (!poLineItemIds.has(li.poLineItemId)) throw AppError.badRequest(`Line item ${li.poLineItemId} does not belong to this purchase order`);
  }

  const [doc] = await db.insert(erpReceivingDocuments).values({ tenantId, purchaseOrderId: po.id, notes, createdBy }).returning();
  await db.insert(erpReceivingLineItems).values(lineItems.map((li) => ({ tenantId, receivingDocumentId: doc!.id, poLineItemId: li.poLineItemId, quantityReceived: li.quantityReceived, notes: li.notes })));
  await recordAuditTrail(db, {
    tenantId,
    entityType: "ReceivingDocument",
    entityId: doc!.id,
    action: "create",
    changes: { purchaseOrderId: po.id, lineItemCount: lineItems.length },
    performedBy: createdBy,
  });

  const receivedTotals = await getReceivedQuantities(db, tenantId, poLineItems.map((li) => li.id));
  const fullyReceived = poLineItems.every((li) => (receivedTotals.get(li.id) ?? 0) >= li.quantity);
  const anyReceived = poLineItems.some((li) => (receivedTotals.get(li.id) ?? 0) > 0);
  const newStatus = fullyReceived ? "received" : anyReceived ? "partially_received" : po.status;

  if (newStatus !== po.status) {
    await db.update(erpPurchaseOrders).set({ status: newStatus, updatedAt: new Date() }).where(eq(erpPurchaseOrders.id, po.id));
  }

  await recordAuditTrail(db, {
    tenantId,
    entityType: "PurchaseOrder",
    entityId: po.id,
    action: "status_change",
    changes: { receivingDocumentId: doc!.id, from: po.status, to: newStatus },
    performedBy: createdBy,
  });

  return doc!;
}
