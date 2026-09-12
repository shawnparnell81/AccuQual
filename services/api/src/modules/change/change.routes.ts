import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createChangeSchema, updateChangeSchema } from "./change.validation.js";
import { baseHandlers, approveHandler } from "./change.controller.js";

export const changeRouter = Router();
changeRouter.use(requireAuth, withTenantDb);

changeRouter.get("/", baseHandlers.list);
changeRouter.post("/", validate(createChangeSchema), baseHandlers.create);
changeRouter.patch("/:id", validate(updateChangeSchema), baseHandlers.update);
changeRouter.post("/:id/approve", approveHandler);
