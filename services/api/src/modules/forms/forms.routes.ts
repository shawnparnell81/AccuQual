import type { NextFunction, Request, Response } from "express";
import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { saveFormSchema } from "./forms.validation.js";
import { getTemplate, getForm, saveForm, createVersion, getHistory, exportForm } from "./forms.controller.js";

export const formsRouter = Router();
formsRouter.use(requireAuth, withTenantDb);

// This router is shared by all 28+ form types (NCR, CAPA, training, ...), most
// of which aren't in the department matrix and stay gated by their owning
// record's own permissions. Only the Production Log family is multi-department
// (Production: read-only, Customer Service: edit — see departmentAccess.ts),
// so the gate below applies only to those :type values and passes everything
// else straight through unchanged.
const PRODUCTION_LOG_TYPES = new Set(["production_log", "daily_production_log", "production_output_log"]);
const productionLogGate = requireDepartmentAccess("production_log");
function gateProductionLogTypes(req: Request, res: Response, next: NextFunction) {
  if (!req.params.type || !PRODUCTION_LOG_TYPES.has(req.params.type)) return next();
  return productionLogGate(req, res, next);
}

formsRouter.get("/:type/template", getTemplate);
formsRouter.get("/:type/:id", getForm);
formsRouter.post("/:type/:id/save", gateProductionLogTypes, validate(saveFormSchema), saveForm);
formsRouter.post("/:type/:id/version", gateProductionLogTypes, createVersion);
formsRouter.get("/:type/:id/history", getHistory);
formsRouter.post("/:type/:id/export", exportForm);
