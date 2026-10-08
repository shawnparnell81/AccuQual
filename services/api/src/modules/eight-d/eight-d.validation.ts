import { z } from "zod";
import { recordNumberSchema } from "../records/userRecordNumber.js";

export const createEightDSchema = z.object({
  recordNumber: recordNumberSchema,
  // .coerce — the quick-create modal (GenericCreateForm) submits every
  // field, matches inventory.validation.ts's own established convention
  // for every optional numeric field. Plain z.number() used to reject a
  // string here with a silent 400.
  ncrId: z.coerce.number().int().optional(),
});

const sheetCells = z.record(z.string(), z.string());

export const updateEightDSchema = z.object({
  recordNumber: recordNumberSchema,
  currentStep: z.coerce.number().int().min(1).max(8).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  problemDescriptionD2: sheetCells.optional(),
  problemSolvingWorksheetD4: sheetCells.optional(),
  testingPossibleCausesD4: sheetCells.optional(),
  decisionMaking: sheetCells.optional(),
  riskAnalysis: sheetCells.optional(),
  planProblemPrevention: sheetCells.optional(),
});

export const completeStepSchema = z.object({
  data: z.record(z.string(), z.unknown()),
});
