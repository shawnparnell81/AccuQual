import { z } from "zod";

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
