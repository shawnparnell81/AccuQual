import { z } from "zod";

const lineItemInput = z.object({
  itemId: z.coerce.number().int(),
  quantity: z.coerce.number().int().positive(),
  unitCost: z.coerce.number().min(0).optional(),
  notes: z.string().optional(),
});

export const createPurchaseOrderSchema = z.object({
  supplierId: z.coerce.number().int(),
  notes: z.string().optional(),
  expectedDeliveryDate: z.string().optional(),
  lineItems: z.array(lineItemInput).min(1, "A purchase order needs at least one line item"),
});

/** Notes/expectedDeliveryDate are editable any time; supplierId/lineItems only while the PO is still "draft" — enforced in the controller, not here. */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  notes: z.string().optional(),
  expectedDeliveryDate: z.string().nullable().optional(),
});

/** Replaces the whole line-item set — draft-only (see the controller). Simpler than granular add/edit/delete-one-line endpoints for a set that's only ever mutable pre-send. */
export const replaceLineItemsSchema = z.object({
  lineItems: z.array(lineItemInput).min(1, "A purchase order needs at least one line item"),
});

const receivingLineItemInput = z.object({
  poLineItemId: z.coerce.number().int(),
  quantityReceived: z.coerce.number().int().positive(),
  notes: z.string().optional(),
  // Phase 8 — captured at the moment of physical receipt; mirrored onto a
  // real inventory_lots row (see erp.service.ts's createReceivingDocument).
  lotNumber: z.string().max(100).optional(),
  serialNumber: z.string().max(100).optional(),
  revisionLevel: z.string().max(50).optional(),
  expirationDate: z.string().optional(),
});

export const createReceivingDocumentSchema = z.object({
  purchaseOrderId: z.coerce.number().int(),
  notes: z.string().optional(),
  lineItems: z.array(receivingLineItemInput).min(1, "A receiving document needs at least one line item"),
});

export const RECEIVING_LINE_ITEM_STATUSES = ["received", "pending_inspection", "inspected", "accepted", "rejected", "quarantined", "disposition_required"] as const;

export const transitionReceivingLineItemSchema = z.object({
  status: z.enum(RECEIVING_LINE_ITEM_STATUSES),
  notes: z.string().optional(),
});

export const createRequisitionSchema = z.object({
  itemId: z.coerce.number().int(),
  quantity: z.coerce.number().int().positive(),
  supplierId: z.coerce.number().int().optional(),
  linkedNcrId: z.coerce.number().int().optional(),
  justification: z.string().optional(),
});

/** Every field optional at the schema level — draft-only editability and who may touch what is enforced in erp.controller.ts, same split every other module in this app uses. */
export const updateRequisitionSchema = z.object({
  quantity: z.coerce.number().int().positive().optional(),
  supplierId: z.coerce.number().int().nullable().optional(),
  linkedNcrId: z.coerce.number().int().nullable().optional(),
  justification: z.string().optional(),
});
