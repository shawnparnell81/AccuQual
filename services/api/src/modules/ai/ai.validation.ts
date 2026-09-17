import { z } from "zod";

export const rootCauseSchema = z.object({ ncrId: z.number().int().optional(), ncrData: z.record(z.string(), z.unknown()) });
export const capaSchema = z.object({ ncrId: z.number().int().optional(), rootCause: z.unknown(), ncrData: z.record(z.string(), z.unknown()) });
export const eightDSchema = z.object({ ncrId: z.number().int().optional(), ncrData: z.record(z.string(), z.unknown()), capaData: z.record(z.string(), z.unknown()) });
export const riskScoreSchema = z.object({ entityType: z.string(), entityId: z.number().int().optional(), input: z.record(z.string(), z.unknown()) });
export const analysisSchema = z.object({
  kind: z.enum(["audit_prep", "document_summary", "predictive_quality"]),
  input: z.union([z.record(z.string(), z.unknown()), z.string()]),
});
export const formSuggestSchema = z.object({ formType: z.string(), partialData: z.record(z.string(), z.unknown()) });
export const formAutofillSchema = z.object({ formType: z.string(), context: z.record(z.string(), z.unknown()) });

// Phase 4 new module-level integration points.
export const ncrTriageSchema = z.object({ ncrId: z.number().int().optional(), input: z.record(z.string(), z.unknown()) });
export const supplierMessageDraftSchema = z.object({ supplierId: z.number().int().optional(), input: z.record(z.string(), z.unknown()) });
export const warrantyTriageSchema = z.object({ claimId: z.number().int().optional(), input: z.record(z.string(), z.unknown()) });
// Phase 8 — "AI-assisted inspection notes."
export const inspectionNotesSchema = z.object({ reportId: z.number().int().optional(), input: z.record(z.string(), z.unknown()) });

// Phase 5 — explicit accept/reject decision on an already-generated suggestion.
export const suggestionDecisionSchema = z.object({ decision: z.enum(["accepted", "rejected"]) });

export const assistantSchema = z.object({
  messages: z
    // max(4000) — a real per-message injection-payload/cost-control cap, on top of the
    // gateway's combined-prompt size cap (llm-gateway.ts's DEFAULT_MAX_PROMPT_CHARS),
    // which only catches an oversized request AFTER all 50 messages are flattened together.
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(4000) }))
    .min(1)
    .max(50), // a generous cap on one request's conversation length — this is a per-session, client-held transcript, not a stored one
  context: z.object({ module: z.string(), recordId: z.coerce.number().int().optional() }).optional(),
});
