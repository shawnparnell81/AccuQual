import { z } from "zod";
import { AQL_VALUES } from "./aql.js";

const LEVELS = ["I", "II", "III", "S-1", "S-2", "S-3", "S-4"] as const;
const SEVERITIES = ["Normal", "Tightened", "Reduced"] as const;
const RISK = ["Critical", "Major", "Minor"] as const;
const LIMIT_TYPES = ["plus_minus", "percent", "min_max", "attribute"] as const;
const PLAN_STATUS = ["Draft", "Active", "Obsolete"] as const;
const TRIGGER_REASONS = [
  "New part", "New supplier", "Supplier factory change", "Receiving location change",
  "6-month repeat", "Annual random pull", "Engineering change", "Other",
] as const;
const RECORD_STATUS = ["draft", "in_inspection", "awaiting_signoff", "passed", "failed", "cancelled"] as const;
const SOURCE_STATUS = ["not_approved", "fai_required", "approved", "suspended"] as const;

export const characteristicSchema = z.object({
  name: z.string().trim().min(1).max(200),
  charType: z.enum(RISK).default("Major"),
  limitType: z.enum(LIMIT_TYPES).default("plus_minus"),
  nominal: z.string().max(60).optional().nullable(),
  tolerancePlus: z.string().max(60).optional().nullable(),
  toleranceMinus: z.string().max(60).optional().nullable(),
  percent: z.string().max(60).optional().nullable(),
  specMin: z.string().max(60).optional().nullable(),
  specMax: z.string().max(60).optional().nullable(),
  unit: z.string().max(40).optional().nullable(),
  method: z.string().max(200).optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
});

export const createPlanSchema = z.object({
  partNumber: z.string().trim().min(1).max(120),
  partDescription: z.string().max(500).optional().nullable(),
  productFamily: z.string().max(200).optional().nullable(),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierFactory: z.string().max(200).optional().nullable(),
  receivingLocation: z.string().max(200).optional().nullable(),
  riskClass: z.enum(RISK).default("Major"),
  repeatIntervalMonths: z.number().int().min(1).max(60).default(6),
  majorAql: z.enum(AQL_VALUES as unknown as [string, ...string[]]).default("1.0"),
  minorAql: z.enum(AQL_VALUES as unknown as [string, ...string[]]).default("2.5"),
  notes: z.string().max(2000).optional().nullable(),
  characteristics: z.array(characteristicSchema).max(200).default([]),
});

export const updatePlanSchema = createPlanSchema.partial().extend({
  status: z.enum(PLAN_STATUS).optional(),
  characteristics: z.array(characteristicSchema).max(200).optional(),
});

export const createRecordSchema = z.object({
  faiNumber: z.string().trim().min(1).max(120),
  planId: z.number().int().positive().optional().nullable(),
  partNumber: z.string().trim().min(1).max(120),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierFactory: z.string().max(200).optional().nullable(),
  receivingLocation: z.string().max(200).optional().nullable(),
  triggerReason: z.enum(TRIGGER_REASONS).optional().nullable(),
  poReference: z.string().max(200).optional().nullable(),
  lotSize: z.number().int().min(2).optional().nullable(),
  inspector: z.string().max(200).optional().nullable(),
  datePulled: z.string().max(40).optional().nullable(),
  dateLabReceived: z.string().max(40).optional().nullable(),
  dateInspected: z.string().max(40).optional().nullable(),
  inspectionLevel: z.enum(LEVELS).default("II"),
  severity: z.enum(SEVERITIES).default("Normal"),
  majorAql: z.enum(AQL_VALUES as unknown as [string, ...string[]]).optional().nullable(),
  minorAql: z.enum(AQL_VALUES as unknown as [string, ...string[]]).optional().nullable(),
  linkedCsaFaiId: z.number().int().positive().optional().nullable(),
  linkedFuelPumpFaiId: z.number().int().positive().optional().nullable(),
  comments: z.string().max(4000).optional().nullable(),
});

export const updateRecordSchema = z.object({
  partNumber: z.string().trim().min(1).max(120).optional(),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierFactory: z.string().max(200).optional().nullable(),
  receivingLocation: z.string().max(200).optional().nullable(),
  triggerReason: z.enum(TRIGGER_REASONS).optional().nullable(),
  poReference: z.string().max(200).optional().nullable(),
  lotSize: z.number().int().min(2).optional().nullable(),
  inspector: z.string().max(200).optional().nullable(),
  datePulled: z.string().max(40).optional().nullable(),
  dateLabReceived: z.string().max(40).optional().nullable(),
  dateInspected: z.string().max(40).optional().nullable(),
  inspectionLevel: z.enum(LEVELS).optional(),
  severity: z.enum(SEVERITIES).optional(),
  majorAql: z.enum(AQL_VALUES as unknown as [string, ...string[]]).optional().nullable(),
  minorAql: z.enum(AQL_VALUES as unknown as [string, ...string[]]).optional().nullable(),
  linkedCsaFaiId: z.number().int().positive().optional().nullable(),
  linkedFuelPumpFaiId: z.number().int().positive().optional().nullable(),
  comments: z.string().max(4000).optional().nullable(),
  status: z.enum(RECORD_STATUS).optional(),
});

export const resultLineSchema = z.object({
  measuredValue: z.string().max(60).optional().nullable(),
  attributeResult: z.enum(["pass", "fail"]).optional().nullable(),
  defects: z.number().int().min(0).max(100000).default(0),
});

export const signRecordSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Enter a 4-digit PIN."),
  certified: z.literal(true),
  outcome: z.enum(["passed", "failed"]),
  description: z.string().min(1).max(400),
});

export const manualSourceStatusSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Enter a 4-digit PIN."),
  certified: z.literal(true),
  status: z.enum(SOURCE_STATUS),
  reason: z.string().trim().min(1).max(500),
  description: z.string().min(1).max(400),
});

export const attachFormSchema = z.object({
  formType: z.enum(["csa", "fuel_pump"]),
});

export const createSourceSchema = z.object({
  partNumber: z.string().trim().min(1).max(120),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierFactory: z.string().max(200).optional().nullable(),
  receivingLocation: z.string().max(200).optional().nullable(),
  status: z.enum(SOURCE_STATUS).default("fai_required"),
});

/** Status is not editable here: changing it stays with the signed manual-status route. */
export const updateSourceSchema = z.object({
  partNumber: z.string().trim().min(1).max(120).optional(),
  supplierId: z.number().int().positive().optional().nullable(),
  supplierFactory: z.string().max(200).optional().nullable(),
  receivingLocation: z.string().max(200).optional().nullable(),
});

export { RECORD_STATUS, SOURCE_STATUS, TRIGGER_REASONS };
