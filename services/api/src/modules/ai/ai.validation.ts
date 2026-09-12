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
