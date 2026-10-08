import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";
import { recordNumberSchema } from "../records/userRecordNumber.js";

export const createAuditSchema = z.object({
  recordNumber: recordNumberSchema,
  name: z.string().min(1),
  type: z.enum(["internal", "supplier", "customer", "certification"]).optional(),
  auditorId: z.number().int().optional(),
  scheduledAt: reasonableDate.optional(),
});

// Status changes only through /start and /complete.
export const updateAuditSchema = createAuditSchema.partial();

/** The checklist in its new order: every question exactly once. */
export const reorderAuditItemsSchema = z.object({
  ids: z.array(z.number().int().positive()).min(2).max(500),
});

export const addAuditItemSchema = z.object({
  question: z.string().min(1),
  finding: z.string().optional(),
  severity: z.enum(["observation", "minor", "major", "critical"]).optional(),
  evidence: z.string().optional(),
});
