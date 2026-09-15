import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createRiskSchema, updateRiskSchema, addFmeaItemSchema, createMitigationSchema, updateMitigationSchema } from "./risk.validation.js";
import {
  listRisksHandler,
  createRiskHandler,
  getRiskHandler,
  updateRiskHandler,
  startMitigationHandler,
  startMonitoringHandler,
  closeRiskHandler,
  deleteRiskHandler,
  addFmeaItemHandler,
  listFmeaItemsHandler,
  createMitigationHandler,
  updateMitigationHandler,
} from "./risk.controller.js";
import { riskAiAnalysisHandler } from "./risk.ai.js";

export const riskRouter = Router();
// quality/engineering/production/purchasing/material_management get "edit"
// (the shared floor: create + propose mitigation) — see departmentAccess.ts
// PERMISSION_MATRIX.risk. The real per-action asymmetry (update/close are
// quality+engineering or quality-only; delete is admin-only) is enforced
// inline in risk.controller.ts's assertDepartment, same pattern every other
// bespoke module in this app uses.
riskRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("risk"));

riskRouter.get("/", listRisksHandler);
riskRouter.post("/", validate(createRiskSchema), createRiskHandler);
riskRouter.get("/:id", getRiskHandler);
riskRouter.put("/:id", validate(updateRiskSchema), updateRiskHandler);
riskRouter.delete("/:id", deleteRiskHandler);

riskRouter.post("/:id/start-mitigation", startMitigationHandler);
riskRouter.post("/:id/start-monitoring", startMonitoringHandler);
riskRouter.post("/:id/close", closeRiskHandler);

riskRouter.get("/:id/fmea", listFmeaItemsHandler);
riskRouter.post("/:id/fmea", validate(addFmeaItemSchema), addFmeaItemHandler);

riskRouter.post("/:id/mitigation", validate(createMitigationSchema), createMitigationHandler);
riskRouter.put("/:id/mitigation/:mid", validate(updateMitigationSchema), updateMitigationHandler);

riskRouter.post("/:id/ai-analysis", riskAiAnalysisHandler);
