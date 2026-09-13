import type { Request, Response } from "express";
import { and, eq, desc } from "drizzle-orm";
import { erpPurchaseOrders, erpPoLineItems, erpReceivingDocuments, erpReceivingLineItems } from "../../drizzle/schema/erp.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import {
  createPurchaseOrder,
  replaceLineItems,
  getLineItems,
  getReceivedQuantities,
  sendPurchaseOrder,
  cancelPurchaseOrder,
  createReceivingDocument,
  type LineItemInput,
} from "./erp.service.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";

/** Purchasing owns the PO lifecycle (create/edit/send/cancel); material_management owns receiving — same inline-guard style as inventory.controller.ts's assertDepartment. */
function assertDepartment(req: Request, allowed: string[]) {
  const role = req.user?.roleName;
  if (role === "admin" || role === "platform_admin") return;
  const department = req.user?.department;
  if (!department || !allowed.includes(department)) {
    throw AppError.forbidden(`This action requires department: ${allowed.join(" or ")}`);
  }
}

async function loadPo(req: Request, id: number) {
  const [po] = await req.db!.select().from(erpPurchaseOrders).where(and(eq(erpPurchaseOrders.id, id), eq(erpPurchaseOrders.tenantId, req.tenantId!)));
  if (!po) throw AppError.notFound("PurchaseOrder");
  return po;
}

/** Joins line items with the item's sku/description (real, live inventory data — never denormalized onto the line item row) plus real received-to-date totals per line. */
async function lineItemsWithContext(req: Request, purchaseOrderId: number) {
  const lineItems = await getLineItems(req.db!, req.tenantId!, purchaseOrderId);
  const itemIds = lineItems.map((li) => li.itemId);
  const items = itemIds.length ? await req.db!.select().from(inventoryItems).where(and(eq(inventoryItems.tenantId, req.tenantId!))) : [];
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const receivedTotals = await getReceivedQuantities(req.db!, req.tenantId!, lineItems.map((li) => li.id));

  return lineItems.map((li) => ({
    ...li,
    sku: itemsById.get(li.itemId)?.sku ?? null,
    description: itemsById.get(li.itemId)?.description ?? null,
    quantityReceived: receivedTotals.get(li.id) ?? 0,
  }));
}

export const listPurchaseOrdersHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!
    .select({
      id: erpPurchaseOrders.id,
      supplierId: erpPurchaseOrders.supplierId,
      supplierName: suppliers.name,
      status: erpPurchaseOrders.status,
      createdAt: erpPurchaseOrders.createdAt,
      notes: erpPurchaseOrders.notes,
    })
    .from(erpPurchaseOrders)
    .innerJoin(suppliers, eq(erpPurchaseOrders.supplierId, suppliers.id))
    .where(eq(erpPurchaseOrders.tenantId, req.tenantId!))
    .orderBy(desc(erpPurchaseOrders.createdAt));
  res.json(rows);
});

export const createPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["purchasing"]);
  const { supplierId, notes, lineItems } = req.body as { supplierId: number; notes?: string; lineItems: LineItemInput[] };
  const po = await createPurchaseOrder(req.db!, req.tenantId!, supplierId, lineItems, notes, req.user?.id);
  res.status(201).json(po);
});

export const getPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  const lineItems = await lineItemsWithContext(req, po.id);
  res.json({ ...po, lineItems });
});

/** Notes are editable any time; supplierId only while draft. */
export const updatePurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  const { supplierId, notes } = req.body as { supplierId?: number; notes?: string };
  if (supplierId !== undefined && po.status !== "draft") {
    throw AppError.badRequest(`Cannot change supplier — purchase order is "${po.status}", not "draft"`);
  }

  const [updated] = await req.db!
    .update(erpPurchaseOrders)
    .set({ ...(supplierId !== undefined ? { supplierId } : {}), ...(notes !== undefined ? { notes } : {}), updatedAt: new Date() })
    .where(eq(erpPurchaseOrders.id, po.id))
    .returning();
  await recordAuditTrail(req.db!, { tenantId: req.tenantId!, entityType: "PurchaseOrder", entityId: po.id, action: "update", changes: { supplierId, notes }, performedBy: req.user?.id });
  res.json(updated);
});

export const replaceLineItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  const { lineItems } = req.body as { lineItems: LineItemInput[] };
  await replaceLineItems(req.db!, req.tenantId!, po, lineItems, req.user?.id);
  const withContext = await lineItemsWithContext(req, po.id);
  res.json(withContext);
});

export const sendPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  res.json(await sendPurchaseOrder(req.db!, req.tenantId!, po, req.user?.id));
});

export const cancelPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  res.json(await cancelPurchaseOrder(req.db!, req.tenantId!, po, req.user?.id));
});

export const listReceivingDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const purchaseOrderId = req.query.purchaseOrderId ? Number(req.query.purchaseOrderId) : undefined;
  const rows = await req.db!
    .select()
    .from(erpReceivingDocuments)
    .where(
      purchaseOrderId
        ? and(eq(erpReceivingDocuments.tenantId, req.tenantId!), eq(erpReceivingDocuments.purchaseOrderId, purchaseOrderId))
        : eq(erpReceivingDocuments.tenantId, req.tenantId!)
    )
    .orderBy(desc(erpReceivingDocuments.createdAt));
  res.json(rows);
});

export const createReceivingDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["material_management"]);
  const { purchaseOrderId, notes, lineItems } = req.body as { purchaseOrderId: number; notes?: string; lineItems: { poLineItemId: number; quantityReceived: number; notes?: string }[] };
  const po = await loadPo(req, purchaseOrderId);
  const doc = await createReceivingDocument(req.db!, req.tenantId!, po, lineItems, notes, req.user?.id);
  res.status(201).json(doc);
});

export const getReceivingDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [doc] = await req.db!.select().from(erpReceivingDocuments).where(and(eq(erpReceivingDocuments.id, id), eq(erpReceivingDocuments.tenantId, req.tenantId!)));
  if (!doc) throw AppError.notFound("ReceivingDocument");
  const lineItems = await req.db!.select().from(erpReceivingLineItems).where(and(eq(erpReceivingLineItems.receivingDocumentId, id), eq(erpReceivingLineItems.tenantId, req.tenantId!)));
  res.json({ ...doc, lineItems });
});

/** GET /erp/overview — real counts + recent activity, for the Dashboard's ERP Overview section. */
export const erpOverviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const pos = await req.db!
    .select({ id: erpPurchaseOrders.id, status: erpPurchaseOrders.status, supplierName: suppliers.name, createdAt: erpPurchaseOrders.createdAt })
    .from(erpPurchaseOrders)
    .innerJoin(suppliers, eq(erpPurchaseOrders.supplierId, suppliers.id))
    .where(eq(erpPurchaseOrders.tenantId, req.tenantId!))
    .orderBy(desc(erpPurchaseOrders.createdAt));

  const countByStatus: Record<string, number> = { draft: 0, sent: 0, partially_received: 0, received: 0, cancelled: 0 };
  for (const po of pos) countByStatus[po.status] = (countByStatus[po.status] ?? 0) + 1;

  res.json({ countByStatus, recent: pos.slice(0, 5) });
});
