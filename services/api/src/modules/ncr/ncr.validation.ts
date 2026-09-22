import { z } from "zod";
import { rejectAiStubText, AI_STUB_REJECT_MESSAGE } from "../ai/ai.guardrails.js";

export const createNcrSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  assignedTo: z.number().int().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

export const updateNcrSchema = createNcrSchema.partial().extend({
  status: z.enum(["open", "contained", "investigating", "corrective_action", "closed"]).optional(),
});

/** Bulk actions pilot (see crudFactory.ts's bulkUpdate) — the same fields a single PATCH accepts, applied to up to 100 NCRs at once, each still getting its own real audit-trail entry. */
export const bulkUpdateNcrSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1).max(100),
  patch: updateNcrSchema,
});

export const assignNcrSchema = z.object({ assignedTo: z.number().int() });
// Phase 4 AI guardrails: these 3 fields are the real onInsert targets of
// AiFieldAssistant's "Insert" button on the NCR workspace page (see Phase
// 0's CAPA data-integrity fix, which found NCR's ActionForms as one of only
// 2 other real sites besides CAPA's rootCause — this closes that loop).
export const containmentNcrSchema = z.object({ containment: z.string().min(1).refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE) });
export const rootCauseNcrSchema = z.object({ rootCause: z.string().min(1).refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE) });
export const correctiveActionNcrSchema = z.object({ correctiveAction: z.string().min(1).refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE) });
