import { z } from "zod";
import { recordNumberSchema } from "../records/userRecordNumber.js";
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
  recordNumber: recordNumberSchema,
});

// Status changes only through /start, /verify, and /close.
export const updateCapaSchema = createCapaSchema.partial();

/**
 * `verification` is the stored effectiveness note. The dashboard tile and the
 * on-screen score are derived and are not validated here. Ten characters still
 * allows a short real note and rejects a one-character placeholder. The stub
 * guard is the same one the other free-text fields use.
 */
export const verifyCapaSchema = z.object({
  verification: z
    .string()
    .min(10, "Provide a real verification note (at least 10 characters), not a placeholder")
    .refine(rejectAiStubText, AI_STUB_REJECT_MESSAGE),
});
