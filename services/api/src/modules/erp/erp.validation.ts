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
  lineItems: z.array(lineItemInput).min(1, "A purchase order needs at least one line item"),
});

/** Notes are editable any time; supplierId/lineItems only while the PO is still "draft" — enforced in the controller, not here. */
export const updatePurchaseOrderSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  notes: z.string().optional(),
});

/** Replaces the whole line-item set — draft-only (see the controller). Simpler than granular add/edit/delete-one-line endpoints for a set that's only ever mutable pre-send. */
export const replaceLineItemsSchema = z.object({
  lineItems: z.array(lineItemInput).min(1, "A purchase order needs at least one line item"),
});

const receivingLineItemInput = z.object({
  poLineItemId: z.coerce.number().int(),
  quantityReceived: z.coerce.number().int().positive(),
  notes: z.string().optional(),
});

export const createReceivingDocumentSchema = z.object({
  purchaseOrderId: z.coerce.number().int(),
  notes: z.string().optional(),
  lineItems: z.array(receivingLineItemInput).min(1, "A receiving document needs at least one line item"),
});
