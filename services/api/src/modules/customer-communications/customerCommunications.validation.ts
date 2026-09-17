import { z } from "zod";

export const COMMS_TYPES = ["email", "phone", "f2f", "portal"] as const;

// Same unconstrained-polymorphic-pair convention as risk.validation.ts's
// RISK_SOURCE_TYPES — see the schema's own header comment for why this
// isn't two separate FK columns.
export const COMMS_SOURCE_TYPES = ["NCR", "Complaint"] as const;

export const createCommunicationSchema = z.object({
  customerId: z.number().int(),
  commsType: z.enum(COMMS_TYPES),
  occurredAt: z.coerce.date().optional(), // defaults to now at the DB level if omitted — see the schema's own defaultNow()
  subject: z.string().optional(),
  summary: z.string().min(1),
  followUpRequired: z.boolean().optional(),
  followUpDate: z.coerce.date().nullable().optional(),
  sourceType: z.enum(COMMS_SOURCE_TYPES).optional(),
  sourceId: z.number().int().optional(),
});

// Deliberately excludes customerId — same "who this record is about doesn't
// change after the fact" reasoning as every other module's update schema
// that omits its own equivalent immutable link (e.g. capa.validation.ts
// never lets ncrId be edited after creation either). Correcting a
// mislogged customer is a delete-and-recreate, not an edit, so the audit
// trail shows a real correction rather than silently retargeting history.
export const updateCommunicationSchema = createCommunicationSchema.partial().omit({ customerId: true });
