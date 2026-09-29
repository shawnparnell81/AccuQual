import { z } from "zod";

/** A supplier's NCR request. Quality reviews it; submitting does not open an NCR. */
export const submitNcrRequestSchema = z.object({
  companyName: z.string().trim().min(1),
  contactName: z.string().trim().min(1),
  email: z.string().email(),
  phoneNumber: z.string().trim().max(40).optional(),
  partNumber: z.string().trim().max(200).optional(),
  summary: z.string().trim().min(1).max(500),
  description: z.string().trim().max(8000).optional(),
});
