import { z } from "zod";
import { CHARACTERISTIC_MODES } from "./fai.logic.js";

const optionalText = (max: number) => z.string().trim().max(max).nullish();

export const characteristicSchema = z.object({
  balloon: optionalText(40),
  name: z.string().trim().min(1).max(200),
  mode: z.enum(CHARACTERISTIC_MODES),
  nominal: optionalText(40),
  percent: optionalText(40),
  plusTolerance: optionalText(40),
  minusTolerance: optionalText(40),
  specMin: optionalText(40),
  specMax: optionalText(40),
});

export const savePlanSchema = z.object({
  name: z.string().trim().min(1).max(200),
  scope: z.enum(["part", "family"]),
  partNumber: optionalText(80),
  partName: optionalText(160),
  productFamily: optionalText(160),
  supplierId: z.number().int().positive().nullish(),
  cadenceMonths: z.number().int().min(1).max(60).optional(),
  notes: optionalText(4000),
  characteristics: z.array(characteristicSchema).min(1).max(200),
});

export const openFaiSchema = z.object({
  planId: z.number().int().positive(),
  partNumber: optionalText(80),
  partName: optionalText(160),
  supplierId: z.number().int().positive(),
  assignedTo: z.number().int().positive().nullish(),
});

export const saveResultsSchema = z.object({
  comments: optionalText(4000),
  lines: z
    .array(
      z.object({
        id: z.number().int().positive(),
        actual: optionalText(40),
        attributeResult: z.enum(["Pass", "Fail"]).nullish(),
      }),
    )
    .min(1),
});

export const assignFaiSchema = z.object({
  userId: z.number().int().positive(),
});

export const faiDecisionSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "Enter a 4-digit PIN."),
  certified: z.literal(true),
});

export const assignPullSchema = z.object({
  partNumber: z.string().trim().min(1).max(80),
  userId: z.number().int().positive(),
});

export const completePullSchema = z.object({
  partNumber: z.string().trim().min(1).max(80),
  faiId: z.number().int().positive().nullish(),
  notes: optionalText(2000),
});
