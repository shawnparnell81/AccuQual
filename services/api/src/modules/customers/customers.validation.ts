import { z } from "zod";

export const CUSTOMER_TYPES = ["OEM", "Tier 1", "Tier 2", "Distributor", "Other"] as const;
export const CUSTOMER_STATUSES = ["draft", "submitted", "under_review", "approved", "activated", "rejected"] as const;

/**
 * Where a Customer Onboarding case can originate from — same polymorphic
 * relatedSourceType/relatedSourceId idea as sales.ts's own SALES_RELATED_SOURCE_TYPES,
 * extended with Risk/Feasibility since a customer case can also start from
 * either of those (see customers.ts's own schema comment).
 */
export const CUSTOMER_RELATED_SOURCE_TYPES = ["NCR", "Supplier", "WorkOrder", "Requisition", "PO", "RMA", "Risk", "Feasibility", "SalesAccount"] as const;

export const createCustomerSchema = z.object({
  legalName: z.string().min(1),
  dbaName: z.string().optional(),
  address: z.string().optional(),
  billingAddress: z.string().optional(),
  website: z.string().optional(),
  primaryContactName: z.string().optional(),
  primaryContactEmail: z.string().optional(),
  primaryContactPhone: z.string().optional(),
  industry: z.string().optional(),
  customerType: z.enum(CUSTOMER_TYPES).optional(),
  department: z.string().optional(),
  ownerId: z.coerce.number().int().optional(),
  ndaDocumentId: z.coerce.number().int().optional(),
  relatedSourceType: z.enum(CUSTOMER_RELATED_SOURCE_TYPES).optional(),
  relatedSourceId: z.coerce.number().int().optional(),
});

// Deliberately excludes `status` — status only ever changes through the
// dedicated transition endpoints below, same reasoning as
// risk.validation.ts's / feasibility.validation.ts's own update schemas.
export const updateCustomerSchema = z.object({
  legalName: z.string().min(1).optional(),
  dbaName: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  billingAddress: z.string().nullable().optional(),
  website: z.string().nullable().optional(),
  primaryContactName: z.string().nullable().optional(),
  primaryContactEmail: z.string().nullable().optional(),
  primaryContactPhone: z.string().nullable().optional(),
  industry: z.string().nullable().optional(),
  customerType: z.enum(CUSTOMER_TYPES).nullable().optional(),
  department: z.string().nullable().optional(),
  ownerId: z.coerce.number().int().nullable().optional(),
  reviewerId: z.coerce.number().int().nullable().optional(),
  ndaDocumentId: z.coerce.number().int().nullable().optional(),
  aiSuggested: z.boolean().optional(),
});
