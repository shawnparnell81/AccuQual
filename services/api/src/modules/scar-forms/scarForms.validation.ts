import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

export const SCAR_STATUSES = ["open", "closed"] as const;

export const createScarFormSchema = z.object({
  scarNumber: z.string().optional(),
  supplierName: z.string().optional(),
  supplierId: z.coerce.number().optional(),
});

export const updateScarFormSchema = z.object({
  scarNumber: z.string().nullable().optional(),
  dateIssued: reasonableDate.nullable().optional(),
  supplierName: z.string().nullable().optional(),
  supplierId: z.coerce.number().nullable().optional(),
  responseDueDate: reasonableDate.nullable().optional(),
  contactPerson: z.string().nullable().optional(),
  poNumber: z.string().nullable().optional(),
  partNumberDescription: z.string().nullable().optional(),
  lotHeatNumber: z.string().nullable().optional(),
  quantityInspected: z.string().nullable().optional(),
  quantityRejected: z.string().nullable().optional(),
  defectDescription: z.string().nullable().optional(),
  quarantineAtSupplier: z.boolean().optional(),
  quarantineInTransit: z.boolean().optional(),
  quarantineAtCustomerSite: z.boolean().optional(),
  containmentPlan: z.string().nullable().optional(),
  why1: z.string().nullable().optional(),
  why2: z.string().nullable().optional(),
  why3: z.string().nullable().optional(),
  why4: z.string().nullable().optional(),
  why5: z.string().nullable().optional(),
  correctiveActionOwner: z.string().nullable().optional(),
  correctiveActionTargetDate: reasonableDate.nullable().optional(),
  preventiveActionOwner: z.string().nullable().optional(),
  preventiveActionTargetDate: reasonableDate.nullable().optional(),
  processUpdateOwner: z.string().nullable().optional(),
  processUpdateTargetDate: reasonableDate.nullable().optional(),
  supplierRepSignature: z.string().nullable().optional(),
  supplierRepDate: reasonableDate.nullable().optional(),
  qualityEngineerSignature: z.string().nullable().optional(),
  qualityEngineerDate: reasonableDate.nullable().optional(),
  status: z.enum(SCAR_STATUSES).optional(),
});
