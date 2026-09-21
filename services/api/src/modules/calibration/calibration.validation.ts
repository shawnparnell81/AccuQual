import { z } from "zod";
import { reasonableDate } from "../../utils/validation.js";

export const createEquipmentSchema = z.object({
  name: z.string().min(1),
  serialNumber: z.string().optional(),
  location: z.string().optional(),
  // "caliper", "torque wrench", "scale"... free text: each organization keeps its own vocabulary.
  type: z.string().trim().max(100).optional(),
  // .coerce — the quick-create modal (GenericCreateForm) submits every
  // field, matches inventory.validation.ts's own established convention
  // for every optional numeric field. Plain z.number() used to reject a
  // string here with a silent 400 (see the QA sweep review).
  calibrationIntervalDays: z.coerce.number().int().positive().optional(),
  // A new record starts active or inactive. Out of service is reached only through a failed calibration or the status endpoint (with a reason).
  status: z.enum(["active", "inactive"]).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

// Full-System Audit finding H2 — equipment could be created but never
// edited (no route mounted for baseHandlers.update at all). Same shape as
// create, all optional, same convention as every other module's
// updateXSchema (e.g. training's updateCourseSchema). `status` is deliberately
// not editable here: it moves only through POST /equipment/:id/status (reason required)
// and through calibration outcomes.
export const updateEquipmentSchema = createEquipmentSchema.omit({ status: true }).partial();

/**
 * POST /equipment/:id/calibration — two shapes on one URL:
 *   { scheduledAt, notes? }                       schedule a calibration for a future date
 *   { performedAt, result, technicianName?, ... } record one that has been done (what the Calibration Record form does)
 */
export const addCalibrationSchema = z
  .object({
    scheduledAt: reasonableDate.optional(),
    performedAt: reasonableDate.optional(),
    result: z.enum(["pass", "fail", "adjusted"]).optional(),
    results: z.record(z.string(), z.unknown()).optional(),
    technicianName: z.string().optional(),
    notes: z.string().optional(),
    certificateUrl: z.string().optional(), // deprecated, kept for backward compatibility — see certificatePath
  })
  .refine((v) => v.performedAt !== undefined || v.scheduledAt !== undefined, { message: "Give either scheduledAt (to schedule) or performedAt and result (to record a finished calibration)." })
  .refine((v) => v.performedAt === undefined || v.result !== undefined, { message: "A finished calibration needs a result: pass, fail or adjusted.", path: ["result"] });

export const completeCalibrationSchema = z.object({
  performedAt: reasonableDate.optional(),
  result: z.enum(["pass", "fail", "adjusted"]),
  results: z.record(z.string(), z.unknown()).optional(),
  technicianName: z.string().optional(),
  notes: z.string().optional(),
});

export const changeStatusSchema = z.object({
  status: z.enum(["active", "inactive", "out_of_service"]),
  reason: z.string().max(1000).optional(),
});
