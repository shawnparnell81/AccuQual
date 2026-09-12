import { z } from "zod";

export const createRiskSchema = z.object({
  title: z.string().min(1),
  processArea: z.string().optional(),
});

export const addFmeaItemSchema = z.object({
  failureMode: z.string().min(1),
  effect: z.string().optional(),
  cause: z.string().optional(),
  severity: z.number().int().min(1).max(10),
  occurrence: z.number().int().min(1).max(10),
  detection: z.number().int().min(1).max(10),
  recommendedAction: z.string().optional(),
});
