import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createEightDSchema, updateEightDSchema, completeStepSchema } from "./eight-d.validation.js";
import { baseHandlers, completeStepHandler } from "./eight-d.controller.js";

export const eightDRouter = Router();
eightDRouter.use(requireAuth, withTenantDb);

eightDRouter.get("/", baseHandlers.list);
eightDRouter.post("/", validate(createEightDSchema), baseHandlers.create);
eightDRouter.get("/:id", baseHandlers.getOne);
eightDRouter.patch("/:id", validate(updateEightDSchema), baseHandlers.update);
eightDRouter.post("/:id/complete-step/:step", validate(completeStepSchema), completeStepHandler);
