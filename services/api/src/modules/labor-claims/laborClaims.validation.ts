import { z } from "zod";

export const LABOR_STATUSES = ["open", "pending", "approved", "denied", "closed"] as const;

const amount = z.union([z.number(), z.string()]).optional().nullable();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();
const linkId = z.coerce.number().int().positive().nullable().optional();

export const createLaborClaimSchema = z.object({
  claimNumber: z.string().trim().min(1, "Type a claim number.").max(120),
  claimDate: day,
  customerName: z.string().trim().max(200).optional().nullable(),
  partName: z.string().trim().max(200).optional().nullable(),
  laborHours: amount,
  laborRate: amount,
  totalLaborCost: amount,
  warrantyClaimId: linkId,
  ncrId: linkId,
  status: z.enum(LABOR_STATUSES).optional(),
  notes: z.string().max(8000).optional().nullable(),
});

export const updateLaborClaimSchema = createLaborClaimSchema.partial().extend({
  claimNumber: z.string().trim().min(1, "Type a claim number.").max(120).optional(),
});
