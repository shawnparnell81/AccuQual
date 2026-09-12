import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createRiskSchema, addFmeaItemSchema } from "./risk.validation.js";
import { baseHandlers, addFmeaItemHandler, listFmeaItemsHandler } from "./risk.controller.js";

export const riskRouter = Router();
riskRouter.use(requireAuth, withTenantDb);

riskRouter.get("/", baseHandlers.list);
riskRouter.post("/", validate(createRiskSchema), baseHandlers.create);
riskRouter.get("/:id", baseHandlers.getOne);
riskRouter.get("/:id/fmea", listFmeaItemsHandler);
riskRouter.post("/:id/fmea", validate(addFmeaItemSchema), addFmeaItemHandler);
