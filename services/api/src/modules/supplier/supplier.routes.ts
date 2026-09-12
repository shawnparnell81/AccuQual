import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createSupplierSchema, addScorecardSchema } from "./supplier.validation.js";
import { baseHandlers, addScorecardHandler } from "./supplier.controller.js";

export const supplierRouter = Router();
supplierRouter.use(requireAuth, withTenantDb);

supplierRouter.get("/", baseHandlers.list);
supplierRouter.post("/", validate(createSupplierSchema), baseHandlers.create);
supplierRouter.get("/:id", baseHandlers.getOne);
supplierRouter.post("/:id/scorecard", validate(addScorecardSchema), addScorecardHandler);
