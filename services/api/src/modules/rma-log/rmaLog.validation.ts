import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

/** "Warranty, scrap, repair, replace, credit" — the brief's own literal list. */
export const DISPOSITION_ACTIONS = ["warranty", "scrap", "repair", "replace", "credit"] as const;

/** open (issued) -> received -> under_review (Quality Team Findings) -> dispositioned (Disposition Action recorded) -> closed. A fixed, linear lifecycle matching the field list's own natural progression — see rmaLog.controller.ts's ALLOWED_NEXT. */
export const RMA_LOG_STATUSES = ["open", "received", "under_review", "dispositioned", "closed"] as const;

const contentFields = {
  dateIssued: reasonableDate.optional(),
  trackingNumber: z.string().nullable().optional(),
  customerName: z.string().nullable().optional(),
  partNumber: z.string().nullable().optional(),
  partDescription: z.string().nullable().optional(),
  quantityReturned: z.coerce.number().nullable().optional(),
  originalOrderNumber: z.string().nullable().optional(),
  serialNumber: z.string().nullable().optional(),
  customerReasonForReturn: z.string().nullable().optional(),
  dateReceived: reasonableDate.nullable().optional(),
  qualityTeamFindings: z.string().nullable().optional(),
  dispositionAction: z.enum(DISPOSITION_ACTIONS).nullable().optional(),
  correctiveAction: z.string().nullable().optional(),
  creditMemo: z.string().nullable().optional(),
  dateClosed: reasonableDate.nullable().optional(),
};

/** The three real integration links — gated separately behind rma_log.linkage.write, see rmaLog.controller.ts. */
const linkFields = {
  warrantyId: z.coerce.number().int().nullable().optional(),
  supplierRmaRequestId: z.coerce.number().int().nullable().optional(),
  qualityId: z.coerce.number().int().nullable().optional(),
};

export const createRmaLogSchema = z.object({ ...contentFields, ...linkFields });
export const updateRmaLogSchema = z.object({ ...contentFields, ...linkFields });
export const transitionRmaLogSchema = z.object({ status: z.enum(RMA_LOG_STATUSES) });
