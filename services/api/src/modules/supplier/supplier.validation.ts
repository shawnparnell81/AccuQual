import { z } from "zod";

export const createSupplierSchema = z.object({
  name: z.string().min(1),
  contactName: z.string().trim().max(200).optional(),
  contactEmail: z.string().email().optional(),
  phone: z.string().trim().max(40).optional(),
});

export const addScorecardSchema = z.object({
  period: z.string().min(1),
  qualityScore: z.number().min(0).max(100).optional(),
  deliveryScore: z.number().min(0).max(100).optional(),
  notes: z.string().optional(),
});

export const createPortalAccountSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
});
