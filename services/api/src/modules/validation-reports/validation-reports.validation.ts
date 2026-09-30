import { z } from "zod";

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const formType = z
  .enum(["csa", "fuel_pump", "air_strut", "air_spring", "fuel_injector", "brake_wear", "shock", "air_compressor", "electric_lift", "gas_lift", "coil_spring"])
  .optional();

const reportData = {
  formType,
  cells: z.record(z.string(), cellValue).optional(),
};

export const createValidationReportSchema = z.object({
  data: z.object(reportData).optional(),
});

export const updateValidationReportSchema = z.object({
  data: z.object({
    formType,
    cells: z.record(z.string(), cellValue),
  }),
});

export const signValidationReportSchema = z.object({
  field: z.enum(["authorizedSignature", "furtherSignature"]).optional(),
  pin: z.string(),
  certified: z.literal(true),
});
