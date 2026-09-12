import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createPpapSchema } from "./ppap.validation.js";
import { baseHandlers } from "./ppap.controller.js";

export const ppapRouter = Router();
ppapRouter.use(requireAuth, withTenantDb);

ppapRouter.get("/", baseHandlers.list);
ppapRouter.post("/", validate(createPpapSchema), baseHandlers.create);
ppapRouter.get("/:id", baseHandlers.getOne);
