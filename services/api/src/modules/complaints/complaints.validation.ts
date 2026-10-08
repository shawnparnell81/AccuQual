import { z } from "zod";
import { recordNumberSchema } from "../records/userRecordNumber.js";

export const createComplaintSchema = z.object({
  recordNumber: recordNumberSchema,
  customerName: z.string().optional(),
  productAffected: z.string().optional(),
  description: z.string().min(1),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  linkedNcrId: z.number().int().optional(),
});

/** Status moves only through /investigate, /resolve, and /close. Nullable ids clear a link or assignment. */
export const updateComplaintSchema = createComplaintSchema.partial().extend({
  linkedNcrId: z.number().int().nullable().optional(),
  assignedTo: z.number().int().nullable().optional(),
  resolution: z.string().optional(),
});

export const resolveComplaintSchema = z.object({
  resolution: z.string().min(1).optional(),
});
