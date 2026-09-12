import { Router } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createCourseSchema, updateCourseSchema, assignSchema, completeAssignmentSchema } from "./training.validation.js";
import {
  listCourses,
  createCourse,
  getCourse,
  updateCourse,
  listAssignmentsForCourse,
  assignHandler,
  completeHandler,
  completeAssignmentHandler,
  uploadCertificateHandler,
  downloadCertificateHandler,
  employeeHistoryHandler,
  listEmployeesHandler,
} from "./training.controller.js";

export const trainingRouter = Router();
trainingRouter.use(requireAuth, withTenantDb);

// Same memoryStorage pattern as document-folders/calibration/documents.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// Fixed-path routes first — would otherwise be swallowed by "/:id".
trainingRouter.get("/employees", listEmployeesHandler);
trainingRouter.get("/employee/:userId/history", employeeHistoryHandler);
trainingRouter.post("/assignment/:assignmentId/complete", validate(completeAssignmentSchema), completeAssignmentHandler);
trainingRouter.post("/assignment/:assignmentId/certificate", upload.single("file"), uploadCertificateHandler);
trainingRouter.get("/assignment/:assignmentId/certificate", downloadCertificateHandler);

trainingRouter.get("/", listCourses);
trainingRouter.post("/", validate(createCourseSchema), createCourse);
trainingRouter.get("/:id", getCourse);
trainingRouter.patch("/:id", validate(updateCourseSchema), updateCourse);
trainingRouter.get("/:id/assignments", listAssignmentsForCourse);
trainingRouter.post("/:id/assign", validate(assignSchema), assignHandler);
trainingRouter.post("/:id/complete", completeHandler);
