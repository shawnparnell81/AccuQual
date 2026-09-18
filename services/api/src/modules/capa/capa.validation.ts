import { z } from "zod";
import { rejectAiStubText, AI_STUB_REJECT_MESSAGE } from "../ai/ai.guardrails.js";

/**
 * Data-integrity guardrail (Phase 0, generalized in Phase 4): a real CAPA
 * record was found with its Root Cause Summary saved as the raw AI-stub
 * JSON object, note field and all — the "Insert as Root Cause" action on
 * the AI assistant took whatever text came back from POST /ai/assistant and
 * wrote it straight into this field with nothing checking whether it was a
 * real answer first. The frontend now refuses to offer that insert when the
 * reply is a stub (see AiFieldAssistant.tsx's `isStub` check), but this is
 * the boundary that can't be bypassed by any client, present or future:
 * reject the exact signature the stub always contains before it ever
 * reaches the database. `rejectAiStubText`/`AI_STUB_REJECT_MESSAGE` now live
 * in ai.guardrails.ts so NCR's ActionForms and Training's course
 * description (the other 2 real onInsert sites Phase 0 found) share this
 * exact check instead of each re-deriving it.
 */
const freeTextField = () => z.string().refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE).optional();

export const createCapaSchema = z.object({
  ncrId: z.number().int().optional(),
  rootCause: freeTextField(),
  actionPlan: freeTextField(),
  preventiveAction: freeTextField(),
  ownerId: z.number().int().optional(),
  dueDate: z.coerce.date().nullable().optional(),
});

// Sprint 2 fix (accuqual-implementation-sequencing.md) — deliberately
// excludes `status`, same reasoning/pattern as risk.validation.ts's
// updateRiskSchema: status only ever changes through the dedicated
// transition endpoints (/start, /verify, /close), each with its own
// ALLOWED_NEXT guard in capa.controller.ts.
export const updateCapaSchema = createCapaSchema.partial();

/**
 * Phase 2 CAPA fix ("validate CAPA effectiveness fields"): `verification`
 * is the one real, stored effectiveness field this app has — the dashboard's
 * "CAPA Effectiveness" tile and the CAPA detail page's "AI Effectiveness
 * Score" panel are both just derived/ephemeral (a closure-rate calculation
 * and a non-persisted AI opinion respectively, see the buyer evaluation —
 * neither is a real field to validate). `.min(1)` let a single-character
 * "x" close out an ISO/IATF effectiveness check; `.min(10)` still allows
 * genuinely short-but-real notes ("No recurrence in 90 days.") while
 * catching placeholder garbage, and the same AI-stub guard every other
 * CAPA free-text field already has closes the same insertable-stub risk
 * here too.
 */
export const verifyCapaSchema = z.object({
  verification: z
    .string()
    .min(10, "Provide a real verification note (at least 10 characters), not a placeholder")
    .refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE),
});
