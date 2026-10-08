import { z } from "zod";
import { SIGNATURE_REQUIRED_KEY, signatureRequiredField } from "../signatures/signatureRequired.js";
import { recordNumberSchema } from "../records/userRecordNumber.js";

const cellValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

const formType = z
  .enum(["csa", "fuel_pump", "air_strut", "air_spring", "fuel_injector", "brake_wear", "shock", "air_compressor", "electric_lift", "gas_lift", "coil_spring"])
  .optional();

const reportData = {
  formType,
  cells: z.record(z.string(), cellValue).optional(),
  [SIGNATURE_REQUIRED_KEY]: signatureRequiredField,
};

export const createValidationReportSchema = z.object({
  recordNumber: recordNumberSchema,
  data: z.object(reportData).optional(),
});

export const updateValidationReportSchema = z.object({
  recordNumber: recordNumberSchema,
  data: z.object({
    formType,
    cells: z.record(z.string(), cellValue),
    [SIGNATURE_REQUIRED_KEY]: signatureRequiredField,
  }),
});

export const signValidationReportSchema = z.object({
  field: z.enum(["authorizedSignature", "furtherSignature"]).optional(),
  pin: z.string(),
  certified: z.literal(true),
});
