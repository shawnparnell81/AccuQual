import { z } from "zod";

export const createNcrSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  assignedTo: z.number().int().optional(),
});

export const updateNcrSchema = createNcrSchema.partial().extend({
  status: z.enum(["open", "contained", "investigating", "corrective_action", "closed"]).optional(),
});

export const assignNcrSchema = z.object({ assignedTo: z.number().int() });
export const containmentNcrSchema = z.object({ containment: z.string().min(1) });
export const rootCauseNcrSchema = z.object({ rootCause: z.string().min(1) });
export const correctiveActionNcrSchema = z.object({ correctiveAction: z.string().min(1) });
