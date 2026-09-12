import { z } from "zod";

export const createDocumentSchema = z.object({
  title: z.string().min(1),
  category: z.string().optional(),
});

export const documentStatusEnum = z.enum(["draft", "in_review", "approved", "obsolete"]);

export const updateDocumentSchema = createDocumentSchema.partial().extend({
  status: documentStatusEnum.optional(),
  expirationDate: z.coerce.date().nullable().optional(),
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
