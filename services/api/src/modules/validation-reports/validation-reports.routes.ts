import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createValidationReportSchema, updateValidationReportSchema } from "./validation-reports.validation.js";
import { baseHandlers } from "./validation-reports.controller.js";

export const validationReportsRouter = Router();

validationReportsRouter.use(requireAuth, withDb, requireDepartmentAccess("documents"));

validationReportsRouter.get("/", baseHandlers.list);
validationReportsRouter.post("/", validate(createValidationReportSchema), baseHandlers.create);
validationReportsRouter.get("/:id", baseHandlers.getOne);
validationReportsRouter.patch("/:id", validate(updateValidationReportSchema), baseHandlers.update);
