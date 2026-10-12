import { z } from "zod";

const EVENT_TYPES = ["awaiting_signoff", "passed", "failed", "due_reminder", "random_pull_approved"] as const;

const memberSchema = z.union([
  z.object({ type: z.literal("user"), userId: z.number().int().positive() }),
  z.object({ type: z.literal("email"), email: z.string().email() }),
]);

export const distributionListSchema = z.object({
  name: z.string().trim().min(1).max(200),
  members: z.array(memberSchema).max(200).default([]),
  matchSiteId: z.number().int().positive().optional().nullable(),
  matchProductFamily: z.string().max(200).optional().nullable(),
  matchTriggerReason: z.string().max(200).optional().nullable(),
  matchEventTypes: z.array(z.enum(EVENT_TYPES)).max(5).default([]),
  mondaySummary: z.boolean().default(false),
});

export const updateDistributionListSchema = distributionListSchema.partial();

export { EVENT_TYPES };
