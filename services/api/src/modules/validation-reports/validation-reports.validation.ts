import { z } from "zod";

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const createValidationReportSchema = z.object({
  data: z
    .object({
      cells: z.record(z.string(), cellValue).optional(),
    })
    .optional(),
});

export const updateValidationReportSchema = z.object({
  data: z.object({
    cells: z.record(z.string(), cellValue),
  }),
});
