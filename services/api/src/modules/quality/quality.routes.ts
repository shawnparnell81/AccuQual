import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createDiscrepancySchema, updateDiscrepancySchema, disposeDiscrepancySchema } from "./quality.validation.js";
import { baseHandlers, updateHandler, investigateHandler, disposeHandler, closeHandler } from "./quality.controller.js";

export const qualityRouter = Router();
// Turns on PERMISSION_MATRIX.di (quality: edit) — previously unenforced.
qualityRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("di"));

qualityRouter.get("/", baseHandlers.list);
qualityRouter.post("/", validate(createDiscrepancySchema), baseHandlers.create);
qualityRouter.get("/:id", baseHandlers.getOne);
qualityRouter.patch("/:id", validate(updateDiscrepancySchema), updateHandler);
// Status moves only through these — never the generic PATCH above.
qualityRouter.post("/:id/investigate", investigateHandler);
qualityRouter.post("/:id/dispose", validate(disposeDiscrepancySchema), disposeHandler);
qualityRouter.post("/:id/close", closeHandler);
