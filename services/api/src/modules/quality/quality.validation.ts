import { z } from "zod";
import { recordNumberSchema } from "../records/userRecordNumber.js";

export const DISPOSITIONS = ["use-as-is", "rework", "repair", "scrap", "return-to-supplier", "sort"] as const;

export const createDiscrepancySchema = z.object({
  recordNumber: recordNumberSchema,
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
});

/** Status moves only through /investigate, /dispose, and /close. */
export const updateDiscrepancySchema = z.object({
  recordNumber: recordNumberSchema,
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
  disposition: z.enum(DISPOSITIONS).nullable().optional(),
  assignedTo: z.number().int().nullable().optional(),
});

export const disposeDiscrepancySchema = z.object({
  disposition: z.enum(DISPOSITIONS).optional(),
});
