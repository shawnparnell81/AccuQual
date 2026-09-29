import { z } from "zod";
import { ISO_FORM_TYPES } from "../../drizzle/schema/isoQualityForms.js";

const cellValue = z.union([z.string().max(20_000), z.number(), z.boolean(), z.null()]);

const scalar = z.union([z.string().max(2_000), z.number(), z.null()]);

const faiLine = z.object({
  balloon: z.string().max(40).optional(),
  characteristic: z.string().max(500).optional(),
  nominal: scalar.optional(),
  tolerance: scalar.optional(),
  actual: scalar.optional(),
});

const scorecardRow = z.object({
  group: z.string().max(80).optional(),
  name: z.string().max(160).optional(),
  voc: z.string().max(16).optional(),
  nbh: z.string().max(16).optional(),
  band: z.enum(["global", "customer"]).optional(),
  ppmMonth: scalar.optional(),
  ppmYtd: scalar.optional(),
  ppmTarget: scalar.optional(),
  ppmPrior: scalar.optional(),
  ppmPctTarget: scalar.optional(),
  nctMonth: scalar.optional(),
  nctYtd: scalar.optional(),
  nctTarget: scalar.optional(),
  nctQty: scalar.optional(),
  nctPctTarget: scalar.optional(),
  otdMonth: scalar.optional(),
  otdTarget: scalar.optional(),
  otdPrior: scalar.optional(),
  otdPctTarget: scalar.optional(),
  otdYear: scalar.optional(),
  freightMonth: scalar.optional(),
  freightYtd: scalar.optional(),
  freightTarget: scalar.optional(),
  warrantyMonth: scalar.optional(),
  warrantyYtd: scalar.optional(),
  warrantyTarget: scalar.optional(),
  volume: scalar.optional(),
});

const failureRow = z.object({
  claimed: scalar.optional(),
  op: z.string().max(500).optional(),
  problem: z.string().max(500).optional(),
  pca: z.string().max(40).optional(),
  months: z.array(scalar).max(18).optional(),
});

const formData = z.object({
  cells: z.record(z.string().max(12), cellValue).optional(),
  photos: z.string().max(200_000).optional(),
  lines: z.array(faiLine).max(40).optional(),
  customers: z.array(scorecardRow).max(24).optional(),
  problems: z.array(failureRow).max(40).optional(),
  months: z.array(z.string().max(40)).max(18).optional(),
});

export const createIsoQualityFormSchema = z.object({
  formType: z.enum(ISO_FORM_TYPES),
  data: formData.optional(),
});

export const updateIsoQualityFormSchema = z.object({
  data: formData,
});
