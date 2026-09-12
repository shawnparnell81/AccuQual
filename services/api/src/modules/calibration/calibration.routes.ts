import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createEquipmentSchema, addCalibrationSchema } from "./calibration.validation.js";
import { baseHandlers, addCalibrationHandler, listCalibrationsHandler, listWithStatus } from "./calibration.controller.js";

export const calibrationRouter = Router();
calibrationRouter.use(requireAuth, withTenantDb);

calibrationRouter.get("/", listWithStatus);
calibrationRouter.post("/", validate(createEquipmentSchema), baseHandlers.create);
calibrationRouter.get("/:id", baseHandlers.getOne);
calibrationRouter.get("/:id/calibration", listCalibrationsHandler);
calibrationRouter.post("/:id/calibration", validate(addCalibrationSchema), addCalibrationHandler);
