import { z } from "zod";

export const createEightDSchema = z.object({
  // .coerce — the quick-create modal (GenericCreateForm) submits every
  // field, matches inventory.validation.ts's own established convention
  // for every optional numeric field. Plain z.number() used to reject a
  // string here with a silent 400 (see the QA sweep review).
  ncrId: z.coerce.number().int().optional(),
});

export const updateEightDSchema = z.object({
  currentStep: z.coerce.number().int().min(1).max(8).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

export const completeStepSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
