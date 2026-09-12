import { z } from "zod";

export const createAuditSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["internal", "supplier", "customer", "certification"]).optional(),
  auditorId: z.number().int().optional(),
  scheduledAt: z.coerce.date().optional(),
});

export const updateAuditSchema = createAuditSchema.partial().extend({
  status: z.enum(["scheduled", "in_progress", "completed"]).optional(),
});

export const addAuditItemSchema = z.object({
  question: z.string().min(1),
  finding: z.string().optional(),
  severity: z.enum(["observation", "minor", "major", "critical"]).optional(),
  evidence: z.string().optional(),
});
