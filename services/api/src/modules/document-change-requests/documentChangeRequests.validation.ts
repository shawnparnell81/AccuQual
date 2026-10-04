import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";
import { signatureRequiredField } from "../signatures/signatureRequired.js";

export const DOCUMENT_CHANGE_STATUSES = ["draft", "active", "obsolete"] as const;

export const createDocumentChangeRequestSchema = z.object({
  formNo: z.string().optional(),
  revision: z.string().optional(),
  effectiveDate: reasonableDate.optional(),
  preparedBy: z.string().optional(),
  approvedBy: z.string().optional(),
  additionalComments: z.string().optional(),
});

export const updateDocumentChangeRequestSchema = z.object({
  formNo: z.string().nullable().optional(),
  revision: z.string().nullable().optional(),
  effectiveDate: reasonableDate.nullable().optional(),
  preparedBy: z.string().nullable().optional(),
  approvedBy: z.string().nullable().optional(),
  status: z.enum(DOCUMENT_CHANGE_STATUSES).optional(),
  additionalComments: z.string().nullable().optional(),
  requesterName: z.string().nullable().optional(),
  requesterTitle: z.string().nullable().optional(),
  actionNew: z.boolean().optional(),
  actionRevision: z.boolean().optional(),
  actionCancellation: z.boolean().optional(),
  docTypeSop: z.boolean().optional(),
  docTypeBulletin: z.boolean().optional(),
  docTypeTemplate: z.boolean().optional(),
  docTypeForm: z.boolean().optional(),
  documentProcessName: z.string().nullable().optional(),
  currentDocNumber: z.string().nullable().optional(),
  currentDocRev: z.string().nullable().optional(),
  currentDocRevDate: reasonableDate.nullable().optional(),
  changeDescription: z.string().nullable().optional(),
  newDocNumber: z.string().nullable().optional(),
  newDocRev: z.string().nullable().optional(),
  newRevDate: reasonableDate.nullable().optional(),
  requestExecutedBy: z.string().nullable().optional(),
  requestExecutedTitle: z.string().nullable().optional(),
  requestExecutedDate: reasonableDate.nullable().optional(),
  signatureRequired: signatureRequiredField,
});

/** SIGN cells only. Dates are server-stamped. Typed names cannot become a signature. */
export const signDocumentChangeRequestSchema = z.object({
  field: z.enum(["requester", "vpEngineering"]),
  pin: z.string().regex(/^\d{4}$/, "Enter a 4-digit PIN."),
  certified: z.literal(true),
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
