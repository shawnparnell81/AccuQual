import { z } from "zod";

export const SCAR_STATUSES = ["open", "closed"] as const;

export const createScarFormSchema = z.object({
  scarNumber: z.string().optional(),
  supplierName: z.string().optional(),
  supplierId: z.coerce.number().optional(),
});

export const updateScarFormSchema = z.object({
  scarNumber: z.string().nullable().optional(),
  dateIssued: z.coerce.date().nullable().optional(),
  supplierName: z.string().nullable().optional(),
  supplierId: z.coerce.number().nullable().optional(),
  responseDueDate: z.coerce.date().nullable().optional(),
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
  correctiveActionTargetDate: z.coerce.date().nullable().optional(),
  preventiveActionOwner: z.string().nullable().optional(),
  preventiveActionTargetDate: z.coerce.date().nullable().optional(),
  processUpdateOwner: z.string().nullable().optional(),
  processUpdateTargetDate: z.coerce.date().nullable().optional(),
  supplierRepSignature: z.string().nullable().optional(),
  supplierRepDate: z.coerce.date().nullable().optional(),
  qualityEngineerSignature: z.string().nullable().optional(),
  qualityEngineerDate: z.coerce.date().nullable().optional(),
  status: z.enum(SCAR_STATUSES).optional(),
});
