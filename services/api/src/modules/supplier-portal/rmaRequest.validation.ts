import { z } from "zod";

/** The Supplier RMA Request's own field list — the brief's "FINAL, CORRECTED LIST", no more, no less. */
export const submitRmaRequestSchema = z.object({
  companyName: z.string().min(1),
  contactName: z.string().min(1),
  email: z.string().email(),
  phoneNumber: z.string().optional(),
  poNumber: z.string().optional(),
  partNumber: z.string().optional(),
  poDate: z.coerce.date().optional(), // "Date PO Was Submitted"
  customerClaimNumber: z.string().optional(),
  shortDescription: z.string().optional(),
  description: z.string().optional(), // the one full text block
});
