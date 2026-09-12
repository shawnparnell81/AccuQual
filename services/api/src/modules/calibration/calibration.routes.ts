import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createEquipmentSchema, addCalibrationSchema } from "./calibration.validation.js";
import {
  baseHandlers,
  addCalibrationHandler,
  listCalibrationsHandler,
  listWithStatus,
  uploadCertificateHandler,
  downloadCertificateHandler,
} from "./calibration.controller.js";

export const calibrationRouter = Router();
calibrationRouter.use(requireAuth, withTenantDb);

// Same pattern as document-folders.routes.ts: memoryStorage, handler decides
// the on-disk path (needs the calibration id multer already parsed).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

calibrationRouter.get("/", listWithStatus);
calibrationRouter.post("/", validate(createEquipmentSchema), baseHandlers.create);
calibrationRouter.get("/:id", baseHandlers.getOne);
calibrationRouter.get("/:id/calibration", listCalibrationsHandler);
calibrationRouter.post("/:id/calibration", validate(addCalibrationSchema), addCalibrationHandler);

calibrationRouter.post("/calibration/:calibrationId/certificate", upload.single("file"), uploadCertificateHandler);
calibrationRouter.get("/calibration/:calibrationId/certificate", downloadCertificateHandler);
