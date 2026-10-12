import { z } from "zod";

const RISK = ["Critical", "Major", "Minor"] as const;

export const updateRulesSchema = z.object({
  pickMode: z.enum(["percent", "count"]).optional(),
  pickPercent: z.number().int().min(1).max(100).optional().nullable(),
  pickCount: z.number().int().min(1).max(100000).optional().nullable(),
  productFamily: z.string().max(200).optional().nullable(),
  riskClass: z.enum(RISK).optional().nullable(),
  siteId: z.number().int().positive().optional().nullable(),
  excludeMonths: z.number().int().min(1).max(60).optional(),
});

export const generateBatchSchema = z.object({
  year: z.number().int().min(2000).max(2200).optional(),
});

export const approveBatchSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Enter a 4-digit PIN."),
  certified: z.literal(true),
  description: z.string().min(1).max(400),
});

export const linkItemSchema = z.object({
  recordId: z.number().int().positive(),
});
