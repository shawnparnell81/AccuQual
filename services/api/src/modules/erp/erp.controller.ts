import type { Request, Response } from "express";
import { and, eq, desc, inArray } from "drizzle-orm";
import { erpPurchaseOrders, erpPoLineItems, erpReceivingDocuments, erpReceivingLineItems, erpPurchaseRequisitions } from "../../drizzle/schema/erp.js";
import { inventoryItems } from "../../drizzle/schema/inventory.js";
import { suppliers } from "../../drizzle/schema/supplier.js";
import { ncr } from "../../drizzle/schema/ncr.js";
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
  submitRequisition,
  approveRequisition,
  rejectRequisition,
  convertRequisitionToPo,
  type LineItemInput,
} from "./erp.service.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { transitionReceivingLineItem } from "./receivingWorkflow.js";
import { qualityInspectionReports } from "../../drizzle/schema/qualityInspectionReports.js";

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
  const [po] = await req.db!.select().from(erpPurchaseOrders).where(and(eq(erpPurchaseOrders.id, id)));
  if (!po) throw AppError.notFound("PurchaseOrder");
  return po;
}

/** Joins line items with the item's sku/description (real, live inventory data — never denormalized onto the line item row) plus real received-to-date totals per line. */
async function lineItemsWithContext(req: Request, purchaseOrderId: number) {
  const lineItems = await getLineItems(req.db!, purchaseOrderId);
  const itemIds = lineItems.map((li) => li.itemId);
  const items = itemIds.length ? await req.db!.select().from(inventoryItems) : [];
  const itemsById = new Map(items.map((i) => [i.id, i]));
  const receivedTotals = await getReceivedQuantities(req.db!, lineItems.map((li) => li.id));

  return lineItems.map((li) => ({
    ...li,
    sku: itemsById.get(li.itemId)?.sku ?? null,
    description: itemsById.get(li.itemId)?.description ?? null,
    quantityReceived: receivedTotals.get(li.id) ?? 0,
  }));
}

/**
 * Phase 1 buyer-evaluation finding ("PO list columns") — totalValue is
 * computed here, not stored: summed from erp_po_line_items' own
 * quantity * unitCost, the same real numbers the PO detail page's line-item
 * table already shows. Two plain queries + a JS reduce, same "tenant-scoped
 * tables are QMS-scale, not warehouse-scale" reasoning inventory's own list
 * handler already uses, rather than a SQL group-by join.
 */
export const listPurchaseOrdersHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!
    .select({
      id: erpPurchaseOrders.id,
      supplierId: erpPurchaseOrders.supplierId,
      supplierName: suppliers.name,
      status: erpPurchaseOrders.status,
      createdAt: erpPurchaseOrders.createdAt,
      notes: erpPurchaseOrders.notes,
      expectedDeliveryDate: erpPurchaseOrders.expectedDeliveryDate,
    })
    .from(erpPurchaseOrders)
    .innerJoin(suppliers, eq(erpPurchaseOrders.supplierId, suppliers.id))
    .orderBy(desc(erpPurchaseOrders.createdAt));

  const lineItems = await req.db!.select().from(erpPoLineItems);
  const totalByPo = new Map<number, number>();
  for (const li of lineItems) {
    const lineTotal = li.quantity * Number(li.unitCost ?? 0);
    totalByPo.set(li.purchaseOrderId, (totalByPo.get(li.purchaseOrderId) ?? 0) + lineTotal);
  }

  res.json(rows.map((po) => ({ ...po, totalValue: totalByPo.get(po.id) ?? 0 })));
});

export const createPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["purchasing"]);
  const { supplierId, notes, lineItems, expectedDeliveryDate } = req.body as { supplierId: number; notes?: string; lineItems: LineItemInput[]; expectedDeliveryDate?: string };
  const po = await createPurchaseOrder(req.db!, supplierId, lineItems, notes, req.user?.id, expectedDeliveryDate);
  res.status(201).json(po);
});

export const getPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  const lineItems = await lineItemsWithContext(req, po.id);
  res.json({ ...po, lineItems });
});

/** Notes and expectedDeliveryDate are editable any time; supplierId only while draft. */
export const updatePurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  const { supplierId, notes, expectedDeliveryDate } = req.body as { supplierId?: number; notes?: string; expectedDeliveryDate?: string | null };
  if (supplierId !== undefined && po.status !== "draft") {
    throw AppError.badRequest(`Cannot change supplier — purchase order is "${po.status}", not "draft"`);
  }

  const [updated] = await req.db!
    .update(erpPurchaseOrders)
    .set({
      ...(supplierId !== undefined ? { supplierId } : {}),
      ...(notes !== undefined ? { notes } : {}),
      ...(expectedDeliveryDate !== undefined ? { expectedDeliveryDate: expectedDeliveryDate ? new Date(expectedDeliveryDate) : null } : {}),
      updatedAt: new Date(),
    })
    .where(eq(erpPurchaseOrders.id, po.id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "PurchaseOrder", entityId: po.id, action: "update", changes: { supplierId, notes }, performedBy: req.user?.id });
  res.json(updated);
});

export const replaceLineItemsHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  const { lineItems } = req.body as { lineItems: LineItemInput[] };
  await replaceLineItems(req.db!, po, lineItems, req.user?.id);
  const withContext = await lineItemsWithContext(req, po.id);
  res.json(withContext);
});

export const sendPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  res.json(await sendPurchaseOrder(req.db!, po, req.user?.id));
});

export const cancelPurchaseOrderHandler = asyncHandler(async (req: Request, res: Response) => {
  const po = await loadPo(req, Number(req.params.id));
  assertDepartment(req, ["purchasing"]);
  res.json(await cancelPurchaseOrder(req.db!, po, req.user?.id));
});

/**
 * GET /erp/receiving-documents — Phase 8 now also inlines each document's
 * line items (a small, per-PO join at this app's QMS scale, same
 * convention listItemsHandler/listAlertsHandler already use elsewhere)
 * since the new per-line status/lot/serial fields are exactly what the
 * Receiving Documents section on ErpPurchaseOrderDetailPage.tsx needs to
 * render — previously only the single-document GET returned them.
 */
export const listReceivingDocumentsHandler = asyncHandler(async (req: Request, res: Response) => {
  const purchaseOrderId = req.query.purchaseOrderId ? Number(req.query.purchaseOrderId) : undefined;
  const rows = await req.db!
    .select()
    .from(erpReceivingDocuments)
    .where(
      purchaseOrderId
        ? and(eq(erpReceivingDocuments.purchaseOrderId, purchaseOrderId))
        : eq(erpReceivingDocuments.tenantId, req.tenantId!)
    )
    .orderBy(desc(erpReceivingDocuments.createdAt));
  if (rows.length === 0) return res.json([]);

  const lineItems = await req.db!
    .select()
    .from(erpReceivingLineItems)
    .where(and(inArray(erpReceivingLineItems.receivingDocumentId, rows.map((r) => r.id))));
  const byDoc = new Map<number, typeof lineItems>();
  for (const li of lineItems) byDoc.set(li.receivingDocumentId, [...(byDoc.get(li.receivingDocumentId) ?? []), li]);

  res.json(rows.map((r) => ({ ...r, lineItems: byDoc.get(r.id) ?? [] })));
});

export const createReceivingDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["material_management"]);
  const { purchaseOrderId, notes, lineItems } = req.body as {
    purchaseOrderId: number;
    notes?: string;
    lineItems: { poLineItemId: number; quantityReceived: number; notes?: string; lotNumber?: string; serialNumber?: string; revisionLevel?: string; expirationDate?: string }[];
  };
  const po = await loadPo(req, purchaseOrderId);
  const doc = await createReceivingDocument(req.db!, req.tenantId!, po, lineItems, notes, req.user?.id);
  res.status(201).json(doc);
});

export const getReceivingDocumentHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [doc] = await req.db!.select().from(erpReceivingDocuments).where(and(eq(erpReceivingDocuments.id, id)));
  if (!doc) throw AppError.notFound("ReceivingDocument");
  const lineItems = await req.db!.select().from(erpReceivingLineItems).where(and(eq(erpReceivingLineItems.receivingDocumentId, id)));
  res.json({ ...doc, lineItems });
});

/**
 * POST /erp/receiving-line-items/:id/status — the one write path for the
 * Phase 8 receiving state machine (see receivingWorkflow.ts). RBAC is
 * enforced inside transitionReceivingLineItem itself (department varies by
 * target state, not a single fixed department the way most actions in
 * this module are), so this handler has no assertDepartment call of its
 * own. Auto-fetches the linked inspection report's defectCategory (if one
 * exists) so the NCR-auto-trigger settings' category filter has something
 * real to check against without the caller having to re-send it.
 */
export const transitionReceivingLineItemHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { status, notes } = req.body as { status: string; notes?: string };

  const [report] = await req.db!.select({ defectCategory: qualityInspectionReports.defectCategory }).from(qualityInspectionReports).where(and(eq(qualityInspectionReports.receivingLineItemId, id)));

  const updated = await transitionReceivingLineItem(req.db!, req.tenantId!, id, status, {
    department: req.user?.department ?? null,
    isAdminOrPlatformAdmin: req.user?.roleName === "admin" || req.user?.roleName === "platform_admin",
    defectCategory: report?.defectCategory ?? undefined,
    notes,
    performedBy: req.user?.id,
    siteId: req.siteId,
  });
  res.json(updated);
});

/** GET /erp/overview — real counts + recent activity, for the Dashboard's ERP Overview section. */
export const erpOverviewHandler = asyncHandler(async (req: Request, res: Response) => {
  const pos = await req.db!
    .select({ id: erpPurchaseOrders.id, status: erpPurchaseOrders.status, supplierName: suppliers.name, createdAt: erpPurchaseOrders.createdAt })
    .from(erpPurchaseOrders)
    .innerJoin(suppliers, eq(erpPurchaseOrders.supplierId, suppliers.id))
    .orderBy(desc(erpPurchaseOrders.createdAt));

  const countByStatus: Record<string, number> = { draft: 0, sent: 0, partially_received: 0, received: 0, cancelled: 0 };
  for (const po of pos) countByStatus[po.status] = (countByStatus[po.status] ?? 0) + 1;

  res.json({ countByStatus, recent: pos.slice(0, 5) });
});

async function loadRequisition(req: Request, id: number) {
  const [row] = await req.db!.select().from(erpPurchaseRequisitions).where(and(eq(erpPurchaseRequisitions.id, id)));
  if (!row) throw AppError.notFound("PurchaseRequisition");
  return row;
}

/** Any requesting department may raise a requisition — this matrix entry grants "edit" to all of them (see departmentAccess.ts's purchase_requisitions), so there's no assertDepartment call here; approve/reject/convert below are purchasing-only. */
export const listRequisitionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { status } = req.query as Record<string, string | undefined>;
  const conditions = [];
  if (status) conditions.push(eq(erpPurchaseRequisitions.status, status));

  const rows = await req
    .db!.select({
      id: erpPurchaseRequisitions.id,
      itemId: erpPurchaseRequisitions.itemId,
      sku: inventoryItems.sku,
      quantity: erpPurchaseRequisitions.quantity,
      supplierId: erpPurchaseRequisitions.supplierId,
      department: erpPurchaseRequisitions.department,
      status: erpPurchaseRequisitions.status,
      justification: erpPurchaseRequisitions.justification,
      createdAt: erpPurchaseRequisitions.createdAt,
    })
    .from(erpPurchaseRequisitions)
    .innerJoin(inventoryItems, eq(erpPurchaseRequisitions.itemId, inventoryItems.id))
    .where(and(...conditions))
    .orderBy(desc(erpPurchaseRequisitions.createdAt));
  res.json(rows);
});

export const createRequisitionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { itemId, quantity, supplierId, linkedNcrId, justification } = req.body as {
    itemId: number;
    quantity: number;
    supplierId?: number;
    linkedNcrId?: number;
    justification?: string;
  };

  const [item] = await req.db!.select({ id: inventoryItems.id, defaultSupplierId: inventoryItems.defaultSupplierId }).from(inventoryItems).where(and(eq(inventoryItems.id, itemId)));
  if (!item) throw AppError.badRequest(`Inventory item #${itemId} not found`);
  if (linkedNcrId !== undefined) {
    const [linked] = await req.db!.select({ id: ncr.id }).from(ncr).where(and(eq(ncr.id, linkedNcrId)));
    if (!linked) throw AppError.badRequest(`NCR #${linkedNcrId} not found`);
  }

  const [created] = await req
    .db!.insert(erpPurchaseRequisitions)
    .values({
      requestedBy: req.user?.id,
      department: req.user?.department ?? null,
      itemId,
      quantity,
      supplierId: supplierId ?? item.defaultSupplierId ?? null,
      linkedNcrId,
      justification,
    })
    .returning();
  await recordAuditTrail(req.db!, { entityType: "PurchaseRequisition", entityId: created!.id, action: "create", changes: req.body, performedBy: req.user?.id });
  res.status(201).json(created);
});

export const getRequisitionHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRequisition(req, Number(req.params.id));
  const [item] = await req.db!.select().from(inventoryItems).where(eq(inventoryItems.id, record.itemId));
  const supplier = record.supplierId ? (await req.db!.select().from(suppliers).where(eq(suppliers.id, record.supplierId)))[0] : null;
  res.json({ ...record, item: item ? { id: item.id, sku: item.sku, description: item.description } : null, supplier: supplier ? { id: supplier.id, name: supplier.name, status: supplier.status } : null });
});

/** draft-only edits — same "only the requester's own draft" spirit as RMA's field-level limits, enforced by status rather than department since any department may own a draft. */
export const updateRequisitionHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRequisition(req, Number(req.params.id));
  if (record.status !== "draft") {
    throw AppError.badRequest(`Cannot edit a requisition that is "${record.status}", not "draft"`);
  }
  const [updated] = await req
    .db!.update(erpPurchaseRequisitions)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(erpPurchaseRequisitions.id, record.id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "PurchaseRequisition", entityId: record.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const submitRequisitionHandler = asyncHandler(async (req: Request, res: Response) => {
  const record = await loadRequisition(req, Number(req.params.id));
  res.json(await submitRequisition(req.db!, record, req.user?.id));
});

export const approveRequisitionHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["purchasing"]);
  const record = await loadRequisition(req, Number(req.params.id));
  res.json(await approveRequisition(req.db!, record, req.user?.id));
});

export const rejectRequisitionHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["purchasing"]);
  const record = await loadRequisition(req, Number(req.params.id));
  res.json(await rejectRequisition(req.db!, record, req.user?.id));
});

export const convertRequisitionToPoHandler = asyncHandler(async (req: Request, res: Response) => {
  assertDepartment(req, ["purchasing"]);
  const record = await loadRequisition(req, Number(req.params.id));
  res.json(await convertRequisitionToPo(req.db!, record, req.user?.id));
});
