import { z } from "zod";

export const createEightDSchema = z.object({
  ncrId: z.number().int().optional(),
});

export const updateEightDSchema = z.object({
  currentStep: z.number().int().min(1).max(8).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const completeStepSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
