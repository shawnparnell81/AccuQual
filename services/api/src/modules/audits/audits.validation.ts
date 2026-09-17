import { z } from "zod";

export const createAuditSchema = z.object({
  name: z.string().min(1),
  type: z.enum(["internal", "supplier", "customer", "certification"]).optional(),
  auditorId: z.number().int().optional(),
  scheduledAt: z.coerce.date().optional(),
});

// Sprint 2 fix (accuqual-implementation-sequencing.md) — deliberately
// excludes `status`. audits.controller.ts's startHandler/completeHandler
// already guard scheduled -> in_progress -> completed correctly, but this
// generic PATCH schema still accepted a raw `status` field, bypassing both
// checks entirely (e.g. PATCH straight from "scheduled" to "completed", or
// backwards from "completed" to "scheduled"). Same exclusion pattern as
// risk.validation.ts's updateRiskSchema — status only ever changes through
// /start and /complete now.
export const updateAuditSchema = createAuditSchema.partial();

export const addAuditItemSchema = z.object({
  question: z.string().min(1),
  finding: z.string().optional(),
  severity: z.enum(["observation", "minor", "major", "critical"]).optional(),
  evidence: z.string().optional(),
});
