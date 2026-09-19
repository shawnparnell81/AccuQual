import { z } from "zod";

export const DISPOSITIONS = ["use-as-is", "rework", "repair", "scrap", "return-to-supplier", "sort"] as const;

export const createDiscrepancySchema = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
});

/**
 * `status` is deliberately NOT editable here — it moves only through the
 * dedicated /investigate, /dispose and /close endpoints (see
 * quality.controller.ts), the same fix the Sprint 2 pass applied to Document
 * Control/CAPA/Audits: a free `status` on the generic PATCH let anyone jump
 * straight to "closed", skipping the sequence checks.
 */
export const updateDiscrepancySchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  severity: z.enum(["minor", "major", "critical"]).optional(),
  disposition: z.enum(DISPOSITIONS).nullable().optional(),
  assignedTo: z.number().int().nullable().optional(),
});

export const disposeDiscrepancySchema = z.object({
  disposition: z.enum(DISPOSITIONS).optional(),
});
