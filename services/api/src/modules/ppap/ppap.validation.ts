import { z } from "zod";
import { recordNumberSchema } from "../records/userRecordNumber.js";

export const createPpapSchema = z.object({
  recordNumber: recordNumberSchema,
  partNumber: z.string().min(1),
  partName: z.string().optional(),
  customer: z.string().optional(),
});

export const updatePpapSchema = createPpapSchema.partial();
