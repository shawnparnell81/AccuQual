import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createValidationReportSchema, signValidationReportSchema, updateValidationReportSchema } from "./validation-reports.validation.js";
import { baseHandlers, copyValidationHandler, listPreviousValidation, signValidationReport, validationPdfHandler } from "./validation-reports.controller.js";
import { z } from "zod";
import { deleteRecordHandler } from "../records/recordDeletion.js";

export const validationReportsRouter = Router();

validationReportsRouter.use(requireAuth, withDb, requireDepartmentAccess("documents"));

validationReportsRouter.get("/", baseHandlers.list);
validationReportsRouter.get("/previous", listPreviousValidation);
validationReportsRouter.post("/copy", validate(z.object({ sourceId: z.number().int().positive() })), copyValidationHandler);
validationReportsRouter.post("/", validate(createValidationReportSchema), baseHandlers.create);
validationReportsRouter.get("/:id/pdf", validationPdfHandler);
validationReportsRouter.get("/:id", baseHandlers.getOne);
validationReportsRouter.patch("/:id", validate(updateValidationReportSchema), baseHandlers.update);
validationReportsRouter.post("/:id/sign", validate(signValidationReportSchema), signValidationReport);
validationReportsRouter.delete("/:id", deleteRecordHandler("validation_report"));
