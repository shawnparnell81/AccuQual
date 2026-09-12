import { z } from "zod";

export const createCapaSchema = z.object({
  ncrId: z.number().int().optional(),
  rootCause: z.string().optional(),
  actionPlan: z.string().optional(),
  preventiveAction: z.string().optional(),
  ownerId: z.number().int().optional(),
});

export const updateCapaSchema = createCapaSchema.partial().extend({
  status: z.enum(["open", "in_progress", "verifying", "closed"]).optional(),
});

export const verifyCapaSchema = z.object({ verification: z.string().min(1) });
