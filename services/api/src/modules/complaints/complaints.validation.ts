import { z } from "zod";

export const createComplaintSchema = z.object({
  customerName: z.string().optional(),
  productAffected: z.string().optional(),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  linkedNcrId: z.number().int().optional(),
});

/**
 * `status` is deliberately NOT editable here — it moves only through the
 * dedicated /investigate, /resolve and /close endpoints (see
 * complaints.controller.ts), the same fix Sprint 2 applied to Document
 * Control/CAPA/Audits. `linkedNcrId`/`assignedTo` are nullable so a link or
 * assignment can be cleared, not just set.
 */
export const updateComplaintSchema = createComplaintSchema.partial().extend({
  linkedNcrId: z.number().int().nullable().optional(),
  assignedTo: z.number().int().nullable().optional(),
  resolution: z.string().optional(),
});

export const resolveComplaintSchema = z.object({
  resolution: z.string().min(1).optional(),
});
