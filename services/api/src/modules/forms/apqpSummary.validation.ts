import { z } from "zod";

/**
 * APQP Summary cells that hold status notes and descriptions. A previous
 * revision stored some of these as numbers; a re-save of that older data
 * still succeeds and is written back as text.
 */
const descriptiveText = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((value) => (typeof value === "number" ? String(value) : value));

/** Genuine counts (Initial Production Samples → Samples). Blank stays blank. */
const count = z
  .union([z.number(), z.string(), z.null()])
  .optional()
  .superRefine((value, ctx) => {
    if (value === undefined || value === null || value === "") return;
    const numeric = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(numeric)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Expected a number" });
    }
  })
  .transform((value) => {
    if (value === undefined || value === null || value === "") return value;
    return typeof value === "number" ? value : Number(value);
  });

const optionalText = z.union([z.string(), z.null()]).optional();

const statusRow = z
  .object({
    required: descriptiveText,
    acceptable: descriptiveText,
    pending: descriptiveText,
  })
  .passthrough();

const sampleRow = z
  .object({
    samples: count,
    characteristics: descriptiveText,
    acceptable: descriptiveText,
  })
  .passthrough();

const signoffRow = z
  .object({
    teamMember: descriptiveText,
    date: optionalText,
  })
  .passthrough();

export const apqpSummaryDataSchema = z
  .object({
    productName: descriptiveText,
    partNumber: descriptiveText,
    customer: descriptiveText,
    manufacturingPlant: descriptiveText,
    date: optionalText,
    processCapability: z.array(statusRow).optional(),
    controlPlanApproved: optionalText,
    controlPlanApprovedDate: optionalText,
    initialProductionSamples: z.array(sampleRow).optional(),
    gageTestEquipment: z.array(statusRow).optional(),
    processMonitoring: z.array(statusRow).optional(),
    packagingShipping: z.array(statusRow).optional(),
    signoffs: z.array(signoffRow).optional(),
  })
  .passthrough();

export function parseApqpSummaryData(data: Record<string, unknown>) {
  return apqpSummaryDataSchema.parse(data);
}
