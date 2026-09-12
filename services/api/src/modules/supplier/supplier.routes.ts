import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createSupplierSchema, addScorecardSchema } from "./supplier.validation.js";
import { baseHandlers, addScorecardHandler, approveHandler, conditionalHandler, suspendHandler, removeHandler } from "./supplier.controller.js";

export const supplierRouter = Router();
// Suppliers is shared by 3 departments at different levels (Quality: edit,
// Purchasing/Material Mgmt: read-only) — see departmentAccess.ts. Note this
// means the 4 dedicated actions below are Quality/admin-only today — real
// Purchasing users only have read access, unlike the brief's assumption
// that Purchasing could approve a supplier (see the Permissions Dictionary).
supplierRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("suppliers"));

supplierRouter.get("/", baseHandlers.list);
supplierRouter.post("/", validate(createSupplierSchema), baseHandlers.create);
supplierRouter.get("/:id", baseHandlers.getOne);
supplierRouter.post("/:id/scorecard", validate(addScorecardSchema), addScorecardHandler);
supplierRouter.post("/:id/approve", approveHandler);
supplierRouter.post("/:id/conditional", conditionalHandler);
supplierRouter.post("/:id/suspend", suspendHandler);
supplierRouter.post("/:id/remove", removeHandler);
