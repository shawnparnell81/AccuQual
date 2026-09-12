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
  certificateUrl: z.string().optional(),
});
