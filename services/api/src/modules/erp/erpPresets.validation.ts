import { z } from "zod";
import { ERP_PRESET_VENDORS, ERP_PRESET_MODULES } from "../../drizzle/schema/erpPresets.js";

export const PRESET_DIRECTIONS = ["push", "pull", "bidirectional"] as const;

const transformRuleSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("dateFormat"), from: z.string().min(1), to: z.string().min(1) }),
  z.object({ kind: z.literal("statusMap"), map: z.record(z.string()), default: z.string().optional() }),
  z.object({ kind: z.literal("codeMap"), map: z.record(z.string()), default: z.string().optional() }),
  z.object({ kind: z.literal("stringCase"), case: z.enum(["upper", "lower", "title"]) }),
  z.object({ kind: z.literal("staticValue"), value: z.string() }),
  z.object({ kind: z.literal("template"), template: z.string().min(1) }),
  z.object({ kind: z.literal("numeric"), op: z.enum(["round", "multiply", "divide", "add"]), value: z.number().optional() }),
  z.object({ kind: z.literal("boolean"), op: z.enum(["invert", "toYesNo", "toTrueFalseString"]) }),
]);

const fieldMappingSchema = z.object({
  source: z.string().min(1),
  target: z.string().min(1),
  direction: z.enum(["push", "pull", "both"]).optional(),
  transform: transformRuleSchema.optional(),
  required: z.boolean().optional(),
});

const triggerRuleSchema = z.object({
  on: z.enum(["create", "update", "statusChange", "workflowEvent"]),
  statusValues: z.array(z.string()).optional(),
});

const validationRuleSchema = z
  .object({
    field: z.string().min(1),
    required: z.boolean().optional(),
    type: z.enum(["string", "number", "date", "boolean"]).optional(),
    allowedValues: z.array(z.string()).optional(),
    pattern: z.string().optional(),
    equalsField: z.string().optional(),
  })
  // Reject a syntactically invalid pattern at save time, not at every sync run.
  .refine((rule) => !rule.pattern || isValidRegex(rule.pattern), { message: "pattern is not a valid regular expression", path: ["pattern"] });

function isValidRegex(source: string): boolean {
  try {
    new RegExp(source);
    return true;
  } catch {
    return false;
  }
}

export const mappingConfigSchema = z.object({
  fieldMappings: z.array(fieldMappingSchema).default([]),
  triggers: z.array(triggerRuleSchema).default([]),
  validationRules: z.array(validationRuleSchema).default([]),
});

export const createErpPresetSchema = z.object({
  vendor: z.enum(ERP_PRESET_VENDORS),
  module: z.enum(ERP_PRESET_MODULES),
  name: z.string().min(1).max(200),
  description: z.string().max(1000).optional(),
  direction: z.enum(PRESET_DIRECTIONS).default("push"),
  mappingConfig: mappingConfigSchema.optional(),
});

export const updateErpPresetSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(1000).optional(),
  direction: z.enum(PRESET_DIRECTIONS).optional(),
  mappingConfig: mappingConfigSchema.optional(),
});
