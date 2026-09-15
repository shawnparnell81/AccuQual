import { z } from "zod";

export const DOCUMENT_CHANGE_STATUSES = ["draft", "active", "obsolete"] as const;

export const createDocumentChangeRequestSchema = z.object({
  formNo: z.string().optional(),
  revision: z.string().optional(),
  effectiveDate: z.coerce.date().optional(),
  preparedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  additionalComments: z.string().optional(),
});

export const updateDocumentChangeRequestSchema = z.object({
  formNo: z.string().nullable().optional(),
  revision: z.string().nullable().optional(),
  effectiveDate: z.coerce.date().nullable().optional(),
  preparedBy: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  status: z.enum(DOCUMENT_CHANGE_STATUSES).optional(),
  additionalComments: z.string().nullable().optional(),
});

export const createChangeItemSchema = z.object({
  changeId: z.string().optional(),
  documentProcess: z.string().optional(),
  currentRevision: z.string().optional(),
  proposedRevision: z.string().optional(),
  reason: z.string().optional(),
  requestedBy: z.string().optional(),
});

export const updateChangeItemSchema = createChangeItemSchema.partial();

export const createReviewSchema = z.object({
  reviewer: z.string().optional(),
  comments: z.string().optional(),
  decision: z.string().optional(),
});

// Deliberately excludes reviewDate — always server-stamped the moment
// decision is first set, never client-supplied (same reasoning as Work
// Order's operation signOffDate).
export const updateReviewSchema = z.object({
  reviewer: z.string().nullable().optional(),
  comments: z.string().nullable().optional(),
  decision: z.string().nullable().optional(),
});
