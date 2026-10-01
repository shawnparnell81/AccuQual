import { z } from "zod";
import { ECR_ACTIONS } from "./changeRequestWorkflow.js";

export const ecrTransitionSchema = z.object({
  action: z.enum(ECR_ACTIONS),
  note: z.string().max(2_000).optional(),
});

export const ecrStructureUnlockSchema = z.object({
  pin: z.string(),
  certified: z.literal(true),
});

export const ecrStructureSaveSchema = z.object({
  pin: z.string(),
  certified: z.literal(true),
  labels: z.record(z.string().max(80), z.string().max(200)),
});
