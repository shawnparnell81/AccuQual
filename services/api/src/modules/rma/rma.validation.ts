import { z } from "zod";

const REASON_CODES = ["defective", "wrong_item", "over_shipment", "under_shipment", "quality_issue", "other"] as const;
export const RMA_STATUSES = ["draft", "submitted_to_supplier", "approved_by_supplier", "in_transit", "received_by_supplier", "closed", "cancelled"] as const;

export const createRmaSchema = z.object({
  supplierId: z.coerce.number().int(),
  reasonCode: z.enum(REASON_CODES).optional(),
  linkedNcrId: z.coerce.number().int().optional(),
  linkedCapaId: z.coerce.number().int().optional(),
  notes: z.string().optional(),
});

/**
 * Every field here is optional at the schema level — which of them a given
 * request may actually touch (quality is limited to notes/linkedNcrId/
 * linkedCapaId; supplierId/reasonCode are draft-only) is enforced in
 * rma.controller.ts, not here, the same split validate() vs. inline-guard
 * every other module in this app uses.
 */
export const updateRmaSchema = z.object({
  supplierId: z.coerce.number().int().optional(),
  reasonCode: z.enum(REASON_CODES).optional(),
  linkedNcrId: z.coerce.number().int().nullable().optional(),
  linkedCapaId: z.coerce.number().int().nullable().optional(),
  notes: z.string().optional(),
});

export const changeRmaStatusSchema = z.object({
  status: z.enum(RMA_STATUSES),
});

export const createRmaItemSchema = z.object({
  itemId: z.coerce.number().int(),
  description: z.string().optional(),
  quantityReturned: z.coerce.number().positive(),
  unitOfMeasure: z.string().optional(),
  reason: z.string().optional(),
  supplierResponse: z.string().optional(),
});

export const updateRmaItemSchema = z.object({
  description: z.string().optional(),
  quantityReturned: z.coerce.number().positive().optional(),
  unitOfMeasure: z.string().optional(),
  reason: z.string().optional(),
  supplierResponse: z.string().optional(),
});
