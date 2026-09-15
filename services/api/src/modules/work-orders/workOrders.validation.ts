import { z } from "zod";

export const WORK_ORDER_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;

export const createWorkOrderSchema = z.object({
  itemId: z.coerce.number().int(),
  quantityPlanned: z.coerce.number().positive(),
  linkedNcrId: z.coerce.number().int().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().optional(),
  revision: z.string().optional(),
});

export const updateWorkOrderSchema = z.object({
  quantityPlanned: z.coerce.number().positive().optional(),
  linkedNcrId: z.coerce.number().int().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().optional(),
  revision: z.string().nullable().optional(),
});

export const completeWorkOrderSchema = z.object({
  quantityCompleted: z.coerce.number().positive(),
});

// ---- Production Work Order traveler (bespoke standalone page — see workOrders.ts's schema comment) ----

export const updateQualityGatesSchema = z.object({
  firstPieceInspectionPassed: z.boolean().optional(),
  finalQcInspectionPassed: z.boolean().optional(),
});

export const signTravelerSchema = z.object({
  signature: z.string().min(1),
});

export const createOperationSchema = z.object({
  opNumber: z.coerce.number().int(),
  description: z.string().min(1),
  workCenter: z.string().optional(),
  completedQty: z.coerce.number().optional(),
});

// Deliberately excludes signOffDate — always server-stamped the moment
// signOff goes from unset to set, never client-supplied.
export const updateOperationSchema = z.object({
  opNumber: z.coerce.number().int().optional(),
  description: z.string().min(1).optional(),
  workCenter: z.string().nullable().optional(),
  completedQty: z.coerce.number().nullable().optional(),
  signOff: z.string().nullable().optional(),
});
