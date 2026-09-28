import { z } from "zod";

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const reportData = {
  formType: z.enum(["csa", "fuel_pump"]).optional(),
  cells: z.record(z.string(), cellValue).optional(),
};

export const createValidationReportSchema = z.object({
  data: z.object(reportData).optional(),
});

export const updateValidationReportSchema = z.object({
  data: z.object({
    formType: z.enum(["csa", "fuel_pump"]).optional(),
    cells: z.record(z.string(), cellValue),
  }),
});
