import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

export const createDocumentSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
});

export const documentStatusEnum = z.enum(["draft", "in_review", "approved", "obsolete"]);

// Sprint 2 fix (accuqual-implementation-sequencing.md) — deliberately excludes
// `status`. It previously changed via a free PATCH field with no guard at
// all, bypassing the real workflow (draft -> in_review is automatic, set only
// by createDocumentVersionRow on a new version; -> approved only via the
// dedicated /approve endpoint; -> obsolete only via the new dedicated
// /obsolete endpoint below). Same "matrix/schema grants nothing, dedicated
// endpoints own the transition" pattern risk.validation.ts's updateRiskSchema
// already uses.
export const updateDocumentSchema = createDocumentSchema.partial().extend({
  expirationDate: reasonableDate.nullable().optional(),
  expirationWarningDays: z.number().int().positive().optional(),
  retentionPeriodDays: z.number().int().positive().optional(),
  retentionAction: z.enum(["archive", "delete"]).optional(),
});

export const addVersionSchema = z.object({
  fileUrl: z.string().min(1),
  changeNotes: z.string().optional(),
});

export const approveSchema = z.object({
  approvalNotes: z.string().optional(),
});
