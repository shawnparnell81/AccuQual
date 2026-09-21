import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { requirePermission } from "../../middleware/requirePermission.js";
import { validate } from "../../middleware/validate.js";
import { createEquipmentSchema, updateEquipmentSchema, addCalibrationSchema, completeCalibrationSchema, changeStatusSchema } from "./calibration.validation.js";
import {
  baseHandlers,
  removeEquipmentHandler,
  addCalibrationHandler,
  completeCalibrationHandler,
  cancelScheduleHandler,
  changeStatusHandler,
  attentionHandler,
  notifyDueHandler,
  getEquipmentHandler,
  listCalibrationsHandler,
  listWithStatus,
  uploadCertificateHandler,
  downloadCertificateHandler,
} from "./calibration.controller.js";

export const calibrationRouter = Router();
// Turns on PERMISSION_MATRIX.calibration (quality: edit) — previously
// unenforced, see the Permissions Dictionary. Each route below also names the
// action it needs (equipment.view / manage / calibrate / override), which resolves onto that same
// department access plus, for the override, a reviewer role — and writes a refusal to the audit trail.
calibrationRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("calibration"));

const view = requirePermission("equipment.view");
const manage = requirePermission("equipment.manage");
const calibrate = requirePermission("equipment.calibrate");

// Same pattern as document-folders.routes.ts: memoryStorage, handler decides
// the on-disk path (needs the calibration id multer already parsed).
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Fixed paths first: "attention" and "notify-due" must not be read as an :id.
calibrationRouter.get("/", view, listWithStatus);
calibrationRouter.get("/attention", view, attentionHandler);
calibrationRouter.post("/notify-due", manage, notifyDueHandler);
calibrationRouter.post("/", manage, validate(createEquipmentSchema), baseHandlers.create);

calibrationRouter.get("/:id", view, getEquipmentHandler);
// Full-System Audit finding H2 — crudFactory's update/remove existed but
// were never mounted at all; equipment could be created but never edited
// or deleted. removeEquipmentHandler wraps baseHandlers.remove with a
// check for real calibration history first (see its own comment) instead
// of mounting baseHandlers.remove directly.
calibrationRouter.patch("/:id", manage, validate(updateEquipmentSchema), baseHandlers.update);
calibrationRouter.delete("/:id", manage, removeEquipmentHandler);
// Status moves (active / inactive / out of service) always carry a reason; returning equipment a failed calibration took out of
// service without a passing calibration is an override and is checked inside (equipment.override).
calibrationRouter.post("/:id/status", manage, validate(changeStatusSchema), changeStatusHandler);

calibrationRouter.get("/:id/calibration", view, listCalibrationsHandler);
calibrationRouter.post("/:id/calibration", calibrate, validate(addCalibrationSchema), addCalibrationHandler);

calibrationRouter.post("/calibration/:calibrationId/complete", calibrate, validate(completeCalibrationSchema), completeCalibrationHandler);
calibrationRouter.delete("/calibration/:calibrationId", calibrate, cancelScheduleHandler);
calibrationRouter.post("/calibration/:calibrationId/certificate", calibrate, upload.single("file"), uploadCertificateHandler);
calibrationRouter.get("/calibration/:calibrationId/certificate", view, downloadCertificateHandler);
