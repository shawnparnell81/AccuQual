import { z } from "zod";

export const WORK_ORDER_STATUSES = ["planned", "in_progress", "completed", "cancelled"] as const;

export const createWorkOrderSchema = z.object({
  itemId: z.coerce.number().int(),
  quantityPlanned: z.coerce.number().positive(),
  linkedNcrId: z.coerce.number().int().optional(),
  dueDate: z.coerce.date().optional(),
  notes: z.string().optional(),
});

export const updateWorkOrderSchema = z.object({
  quantityPlanned: z.coerce.number().positive().optional(),
  linkedNcrId: z.coerce.number().int().nullable().optional(),
  dueDate: z.coerce.date().nullable().optional(),
  notes: z.string().optional(),
});

export const completeWorkOrderSchema = z.object({
  quantityCompleted: z.coerce.number().positive(),
});
