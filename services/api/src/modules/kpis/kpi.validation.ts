import { z } from "zod";
import { DIRECTIONS, FREQUENCIES, METRIC_IDS, PLANT_SCOPES } from "./kpi.model.js";

export const objectiveBodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  metric: z.enum(METRIC_IDS as [string, ...string[]]),
  plantScope: z.enum(PLANT_SCOPES),
  target: z.coerce.number().finite(),
  direction: z.enum(DIRECTIONS),
  amberThreshold: z.coerce.number().finite(),
  ownerId: z.number().int().positive().nullable(),
  reviewFrequency: z.enum(FREQUENCIES),
  active: z.boolean(),
  notes: z.string().max(2000),
});

export const chartLayoutSchema = z.object({
  surface: z.enum(["home", "executive"]),
  order: z.array(z.string().trim().min(1).max(40)).max(40),
});
