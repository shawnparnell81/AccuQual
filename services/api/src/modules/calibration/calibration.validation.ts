import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

export const createEquipmentSchema = z.object({
  name: z.string().min(1),
  serialNumber: z.string().optional(),
  location: z.string().optional(),
  // .coerce — the quick-create modal (GenericCreateForm) submits every
  // field, matches inventory.validation.ts's own established convention
  // for every optional numeric field. Plain z.number() used to reject a
  // string here with a silent 400 (see the QA sweep review).
  calibrationIntervalDays: z.coerce.number().int().positive().optional(),
});

export const addCalibrationSchema = z.object({
  performedAt: reasonableDate,
  result: z.enum(["pass", "fail", "adjusted"]),
  technicianName: z.string().optional(),
  notes: z.string().optional(),
  certificateUrl: z.string().optional(), // deprecated, kept for backward compatibility — see certificatePath
});
