import { z } from "zod";

export const createComplaintSchema = z.object({
  customerName: z.string().optional(),
  productAffected: z.string().optional(),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  linkedNcrId: z.number().int().optional(),
});

export const updateComplaintSchema = createComplaintSchema.partial().extend({
  status: z.enum(["open", "investigating", "resolved", "closed"]).optional(),
  assignedTo: z.number().int().optional(),
});
