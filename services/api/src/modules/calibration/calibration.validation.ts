import { z } from "zod";

export const createEquipmentSchema = z.object({
  name: z.string().min(1),
  serialNumber: z.string().optional(),
  location: z.string().optional(),
  calibrationIntervalDays: z.number().int().positive().optional(),
});

export const addCalibrationSchema = z.object({
  performedAt: z.coerce.date(),
  result: z.enum(["pass", "fail", "adjusted"]),
  technicianName: z.string().optional(),
  notes: z.string().optional(),
  certificateUrl: z.string().optional(), // deprecated, kept for backward compatibility — see certificatePath
});
