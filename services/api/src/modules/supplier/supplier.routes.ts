import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createSupplierSchema, addScorecardSchema } from "./supplier.validation.js";
import { baseHandlers, addScorecardHandler } from "./supplier.controller.js";

export const supplierRouter = Router();
// Suppliers is shared by 3 departments at different levels (Quality: edit,
// Purchasing/Material Mgmt: read-only) — see departmentAccess.ts.
supplierRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("suppliers"));

supplierRouter.get("/", baseHandlers.list);
supplierRouter.post("/", validate(createSupplierSchema), baseHandlers.create);
supplierRouter.get("/:id", baseHandlers.getOne);
supplierRouter.post("/:id/scorecard", validate(addScorecardSchema), addScorecardHandler);
