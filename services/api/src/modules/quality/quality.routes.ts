import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createDiscrepancySchema, updateDiscrepancySchema } from "./quality.validation.js";
import { baseHandlers, closeHandler } from "./quality.controller.js";

export const qualityRouter = Router();
qualityRouter.use(requireAuth, withTenantDb);

qualityRouter.get("/", baseHandlers.list);
qualityRouter.post("/", validate(createDiscrepancySchema), baseHandlers.create);
qualityRouter.get("/:id", baseHandlers.getOne);
qualityRouter.patch("/:id", validate(updateDiscrepancySchema), baseHandlers.update);
qualityRouter.post("/:id/close", closeHandler);
