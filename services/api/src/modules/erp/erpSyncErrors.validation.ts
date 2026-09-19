import { z } from "zod";
import { ERP_ERROR_TYPES } from "../../drizzle/schema/erpSyncErrors.js";

const boolFromQuery = z
  .enum(["true", "false"])
  .optional()
  .transform((v) => (v === undefined ? undefined : v === "true"));

export const listErpSyncErrorsQuerySchema = z.object({
  module: z.string().optional(),
  errorType: z.enum(ERP_ERROR_TYPES).optional(),
  presetVersion: z.coerce.number().int().optional(),
  resolved: boolFromQuery,
  since: z.coerce.date().optional(),
  until: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
});
