import { z } from "zod";
import { recordNumberSchema } from "../records/userRecordNumber.js";
import { rejectAiStubText, AI_STUB_REJECT_MESSAGE } from "../ai/ai.guardrails.js";
import { NCR_ITEM_DISPOSITIONS } from "../quarantine/quarantine.service.js";
import { NCR_STATUS_INPUTS, canonicalNcrStep } from "./ncr.workflow.js";
import { reasonableDate } from "../../utils/validation.js";

export const createNcrSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["low", "medium", "high", "critical"]).optional(),
  assignedTo: z.number().int().optional(),
  dueDate: reasonableDate.nullable().optional(),
  recordNumber: recordNumberSchema,
});

export const updateNcrSchema = createNcrSchema.partial().extend({
  status: z
    .enum(NCR_STATUS_INPUTS)
    .optional()
    .transform((value) => (value === undefined ? undefined : canonicalNcrStep(value))),
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
/** Moves Contain → Disposition. This is the workflow step, not the quarantine material disposition. */
export const dispositionStepNcrSchema = z.object({
  note: z.string().trim().min(1).max(4000).optional(),
});
/** Moves Fix → Verify. The note is stored on the record and on the audit entry. */
export const verifyNcrSchema = z.object({
  verification: z.string().trim().min(1).max(4000),
});

/** Published documents linked on one NCR step. Replaces that step's list only. */
export const ncrStepDocumentsSchema = z.object({
  step: z.string().trim().min(1).max(80),
  documents: z
    .array(z.object({ id: z.number().int().positive(), title: z.string().trim().min(1).max(300) }))
    .max(30),
});

export const addNcrQuarantineItemSchema = z.object({
  partNumber: z.string().trim().min(1).max(200),
  quantity: z.coerce.number().positive(),
  serialNumber: z.string().trim().max(200).optional(),
});

export const completeNcrDispositionSchema = z.object({
  disposition: z.enum(NCR_ITEM_DISPOSITIONS),
  concession: z.enum(["with", "none"]).optional(),
  /** False saves the choice on the open quarantine lines without releasing them. Omitted still releases, except On Hold, which never releases. */
  release: z.boolean().optional(),
});
