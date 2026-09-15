import { z } from "zod";

export const INSPECTION_TYPES = ["incoming", "in_process", "final"] as const;
export const INSPECTION_FINAL_STATUSES = ["accepted", "rejected", "rework_required", "accepted_via_deviation"] as const;
export const INSPECTION_ITEM_RESULTS = ["pass", "fail"] as const;

export const createQualityInspectionReportSchema = z.object({
  inspectionType: z.enum(INSPECTION_TYPES).optional(),
});

export const updateQualityInspectionReportSchema = z.object({
  inspectionDate: z.coerce.date().nullable().optional(),
  inspectorName: z.string().nullable().optional(),
  inspectionType: z.enum(INSPECTION_TYPES).nullable().optional(),
  partMaterialNo: z.string().nullable().optional(),
  poJobNo: z.string().nullable().optional(),
  supplierVendor: z.string().nullable().optional(),
  batchLotNo: z.string().nullable().optional(),
  totalQuantity: z.string().nullable().optional(),
  sampleSize: z.string().nullable().optional(),
  finalStatus: z.enum(INSPECTION_FINAL_STATUSES).nullable().optional(),
  notesRemarks: z.string().nullable().optional(),
  inspectorSignature: z.string().nullable().optional(),
  inspectorSignatureDate: z.coerce.date().nullable().optional(),
  qaLeadSignature: z.string().nullable().optional(),
  qaLeadSignatureDate: z.coerce.date().nullable().optional(),
});

export const createInspectionItemSchema = z.object({
  itemNumber: z.coerce.number().optional(),
  parameter: z.string().optional(),
  specification: z.string().optional(),
});

export const updateInspectionItemSchema = z.object({
  itemNumber: z.coerce.number().nullable().optional(),
  parameter: z.string().nullable().optional(),
  specification: z.string().nullable().optional(),
  actualFinding: z.string().nullable().optional(),
  result: z.enum(INSPECTION_ITEM_RESULTS).nullable().optional(),
});
