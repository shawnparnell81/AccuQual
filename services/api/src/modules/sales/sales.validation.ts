import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

export const ACCOUNT_STATUSES = ["prospect", "active", "dormant"] as const;
export const QUOTE_STATUSES = ["draft", "submitted", "accepted", "rejected", "archived"] as const;
export const CONTRACT_STATUSES = ["draft", "active", "expired", "archived"] as const;
export const CONTRACT_TYPES = ["customer", "service", "pricing", "renewal"] as const;
export const ACTIVITY_TYPES = ["call", "meeting", "email", "demo", "follow_up", "note"] as const;
export const SALES_RELATED_SOURCE_TYPES = ["NCR", "PPAP", "ChangeRequest", "WorkOrder", "Requisition", "PO", "RMA"] as const;

export const createAccountSchema = z.object({
  customerName: z.string().min(1),
  industry: z.string().optional(),
  primaryContactName: z.string().optional(),
  primaryContactEmail: z.string().email().optional().or(z.literal("")),
  primaryContactPhone: z.string().optional(),
  ownerId: z.coerce.number().int().optional(),
});

export const updateAccountSchema = createAccountSchema.partial();

export const createActivitySchema = z.object({
  activityType: z.enum(ACTIVITY_TYPES),
  notes: z.string().optional(),
  nextSteps: z.string().optional(),
  dueDate: reasonableDate.optional(),
  ownerId: z.coerce.number().int().optional(),
  relatedSourceType: z.enum(SALES_RELATED_SOURCE_TYPES).optional(),
  relatedSourceId: z.coerce.number().int().optional(),
});

export const createQuoteSchema = z.object({
  quoteNumber: z.string().min(1).optional(), // auto-generated as Q-{id} if omitted
  revision: z.coerce.number().int().min(1).optional(),
  pricingSheetDocumentId: z.coerce.number().int().optional(),
});

export const updateQuoteSchema = z.object({
  revision: z.coerce.number().int().min(1).optional(),
  pricingSheetDocumentId: z.coerce.number().int().nullable().optional(),
});

export const createContractSchema = z.object({
  contractType: z.enum(CONTRACT_TYPES),
  effectiveDate: reasonableDate.optional(),
  expirationDate: reasonableDate.optional(),
});

export const updateContractSchema = z.object({
  contractType: z.enum(CONTRACT_TYPES).optional(),
  effectiveDate: reasonableDate.nullable().optional(),
  expirationDate: reasonableDate.nullable().optional(),
});
