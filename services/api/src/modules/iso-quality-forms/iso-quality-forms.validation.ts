import { z } from "zod";
import { ISO_FORM_TYPES } from "../../drizzle/schema/isoQualityForms.js";

const cellValue = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]);

const formData = z.object({
  cells: z.record(z.string().max(12), cellValue).optional(),
  photos: z.string().max(200_000).optional(),
});

export const createIsoQualityFormSchema = z.object({
  formType: z.enum(ISO_FORM_TYPES),
  data: formData.optional(),
});

export const updateIsoQualityFormSchema = z.object({
  data: formData,
});
