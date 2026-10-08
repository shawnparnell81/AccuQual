import { z } from "zod";
import { recordNumberSchema } from "../records/userRecordNumber.js";

export const createChangeSchema = z.object({
  recordNumber: recordNumberSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  impactAssessment: z.string().optional(),
});

export const updateChangeSchema = createChangeSchema.partial().extend({
  status: z.enum(["submitted", "under_review", "approved", "rejected", "implemented"]).optional(),
});
