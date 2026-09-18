import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createEquipmentSchema, updateEquipmentSchema, addCalibrationSchema } from "./calibration.validation.js";
import {
  baseHandlers,
  removeEquipmentHandler,
  addCalibrationHandler,
  listCalibrationsHandler,
  listWithStatus,
  uploadCertificateHandler,
  downloadCertificateHandler,
} from "./calibration.controller.js";

export const calibrationRouter = Router();
// Turns on PERMISSION_MATRIX.calibration (quality: edit) — previously
// unenforced, see the Permissions Dictionary.
calibrationRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("calibration"));

// Same pattern as document-folders.routes.ts: memoryStorage, handler decides
// the on-disk path (needs the calibration id multer already parsed).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

calibrationRouter.get("/", listWithStatus);
calibrationRouter.post("/", validate(createEquipmentSchema), baseHandlers.create);
calibrationRouter.get("/:id", baseHandlers.getOne);
// Full-System Audit finding H2 — crudFactory's update/remove existed but
// were never mounted at all; equipment could be created but never edited
// or deleted. removeEquipmentHandler wraps baseHandlers.remove with a
// check for real calibration history first (see its own comment) instead
// of mounting baseHandlers.remove directly.
calibrationRouter.patch("/:id", validate(updateEquipmentSchema), baseHandlers.update);
calibrationRouter.delete("/:id", removeEquipmentHandler);
calibrationRouter.get("/:id/calibration", listCalibrationsHandler);
calibrationRouter.post("/:id/calibration", validate(addCalibrationSchema), addCalibrationHandler);

calibrationRouter.post("/calibration/:calibrationId/certificate", upload.single("file"), uploadCertificateHandler);
calibrationRouter.get("/calibration/:calibrationId/certificate", downloadCertificateHandler);
