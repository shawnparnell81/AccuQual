import { z } from "zod";

const day = z
  .string()
  .optional()
  .transform((value) => (value == null || value === "" ? undefined : value));

const plantId = z
  .union([z.literal("all"), z.coerce.number().int().positive()])
  .optional();

/** Shared by the run endpoints and the export query string. */
export const reportRunSchema = z.object({
  from: day,
  to: day,
  plantId,
});

export const reportExportSchema = reportRunSchema.extend({
  type: z.enum(["weekly", "monthly", "adhoc"]),
  format: z.enum(["csv", "json", "pdf"]).default("json"),
});
