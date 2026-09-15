import { z } from "zod";

export const WARRANTY_STATUSES = ["new", "inspection", "supplier_review", "approved", "rejected", "replaced", "repaired", "closed"] as const;
export const WARRANTY_COST_TYPES = ["parts", "labor", "shipping", "replacement_unit", "other"] as const;

export const createWarrantyClaimSchema = z.object({
  customerId: z.coerce.number().int().optional(),
  productId: z.coerce.number().int().optional(),
  serialNumber: z.string().optional(),
  purchaseDate: z.coerce.date().optional(),
  failureDate: z.coerce.date().optional(),
  failureDescription: z.string().optional(),
  warrantyCostEstimate: z.coerce.number().optional(),
  supplierId: z.coerce.number().int().optional(),
  linkedNcrId: z.coerce.number().int().optional(),
  linkedWorkOrderId: z.coerce.number().int().optional(),
});

/**
 * Every field optional at the schema level — which of these a given request
 * may actually touch depends on the claim's current status and the caller's
 * department, enforced inline in warranty.controller.ts (same
 * validate()-vs-inline-guard split every other module here uses, e.g.
 * rma.validation.ts's updateRmaSchema).
 */
export const updateWarrantyClaimSchema = z.object({
  customerId: z.coerce.number().int().nullable().optional(),
  productId: z.coerce.number().int().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  failureDate: z.coerce.date().nullable().optional(),
  failureDescription: z.string().nullable().optional(),
  warrantyCostEstimate: z.coerce.number().nullable().optional(),
  supplierId: z.coerce.number().int().nullable().optional(),
  linkedNcrId: z.coerce.number().int().nullable().optional(),
  linkedWorkOrderId: z.coerce.number().int().nullable().optional(),
  inspectionNotes: z.string().nullable().optional(),
  inspectionDate: z.coerce.date().nullable().optional(),
  supplierReviewNotes: z.string().nullable().optional(),
  dispositionNotes: z.string().nullable().optional(),
});

export const transitionWarrantyClaimSchema = z.object({
  status: z.enum(WARRANTY_STATUSES),
  note: z.string().optional(),
});

export const createWarrantyCostSchema = z.object({
  costType: z.enum(WARRANTY_COST_TYPES),
  amount: z.coerce.number().positive(),
  notes: z.string().optional(),
});

export const uploadWarrantyDocumentSchema = z.object({
  category: z.enum(["failure_image", "document"]).default("document"),
  caption: z.string().optional(),
});
