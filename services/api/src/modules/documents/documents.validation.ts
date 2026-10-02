import { z } from "zod";

/** Approval Date / Approved By typed on the Master Document List. Null clears a saved override. */
export const patchMasterListRowSchema = z
  .object({
    id: z.number().int().refine((id) => id !== 0, "A list row is required"),
    approvalDate: z.string().trim().max(40).nullable().optional(),
    approvedBy: z.string().trim().max(200).nullable().optional(),
  })
  .strict();

export const createDocumentSchema = z.object({
  title: z.string().trim().min(1).max(300),
  category: z.string().trim().max(100).optional(),
});

export const documentStatusEnum = z.enum(["draft", "in_review", "approved", "obsolete"]);

// What can still be changed on the document record itself: settings that are not part of a revision. The title, category,
// dates, content, files and links are all part of a revision and change only through a draft (reviewed, published, and
// recorded in the version history) — so they are deliberately not accepted here, and neither is `status`, which only the
// lifecycle endpoints move. Any other key is rejected rather than silently ignored.
export const updateDocumentSchema = z
  .object({
    tags: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    ownerId: z.number().int().positive().nullable().optional(),
    expirationWarningDays: z.number().int().positive().optional(),
    retentionPeriodDays: z.number().int().positive().optional(),
    retentionAction: z.enum(["archive", "delete"]).optional(),
  })
  .strict();

/** Send a draft for review, optionally naming who should review it. */
export const requestReviewSchema = z.object({
  notes: z.string().max(4000).optional(),
  reviewerId: z.number().int().positive().optional(),
});

/** A reviewer's decision. Sending a version back needs a reason (enforced by the engine). */
export const decisionSchema = z.object({ notes: z.string().max(4000).optional() });

/** Move into Obsolete / Archive. The reason is stored on the audit row. Acknowledgement is the "I understand" checkbox; confirmation is the typed document number or name. */
export const moveToObsoleteSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  acknowledged: z.boolean().optional(),
  confirmation: z.string().trim().max(300).optional(),
});

/** Return an archived document to the folder it came from. */
export const restoreArchivedDocumentSchema = z.object({
  reason: z.string().trim().min(1).max(500),
  acknowledged: z.literal(true),
});
