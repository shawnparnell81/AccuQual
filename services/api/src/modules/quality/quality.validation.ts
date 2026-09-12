import { z } from "zod";

export const createDiscrepancySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
});

export const updateDiscrepancySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
  disposition: z.enum(["use-as-is", "rework", "repair", "scrap", "return-to-supplier", "sort"]).optional(),
  status: z.enum(["open", "investigating", "disposed", "closed"]).optional(),
  assignedTo: z.number().int().optional(),
});
