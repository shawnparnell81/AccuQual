import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createFeasibilitySchema, updateFeasibilitySchema, createScoreSchema, updateScoreSchema } from "./feasibility.validation.js";
import {
  listFeasibilityHandler,
  createFeasibilityHandler,
  getFeasibilityHandler,
  updateFeasibilityHandler,
  submitFeasibilityHandler,
  reviewFeasibilityHandler,
  approveFeasibilityHandler,
  rejectFeasibilityHandler,
  deleteFeasibilityHandler,
  addScoreHandler,
  updateScoreHandler,
} from "./feasibility.controller.js";

export const feasibilityRouter = Router();
// quality/engineering/production/purchasing/material_management get "edit"
// (the shared floor: create + add/update scores) — see departmentAccess.ts
// PERMISSION_MATRIX.feasibility. Per-action asymmetry (record update:
// quality+engineering only; workflow transitions: quality only; delete:
// quality or admin) is enforced inline in feasibility.controller.ts's
// assertDepartment, same pattern as risk.controller.ts.
//
// No dedicated AI endpoint on this router by design — per the module's own
// locked decision, Feasibility AI routes through the generic
// POST /ai/assistant (context.module = "feasibility"), not a bespoke
// pipeline like risk.controller.ts's /risk/:id/ai-analysis. See
// ai.assistant.ts's loadContextSummary for the "feasibility" case.
feasibilityRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("feasibility"));

feasibilityRouter.get("/", listFeasibilityHandler);
feasibilityRouter.post("/", validate(createFeasibilitySchema), createFeasibilityHandler);
feasibilityRouter.get("/:id", getFeasibilityHandler);
feasibilityRouter.put("/:id", validate(updateFeasibilitySchema), updateFeasibilityHandler);
feasibilityRouter.delete("/:id", deleteFeasibilityHandler);

feasibilityRouter.post("/:id/submit", submitFeasibilityHandler);
feasibilityRouter.post("/:id/review", reviewFeasibilityHandler);
feasibilityRouter.post("/:id/approve", approveFeasibilityHandler);
feasibilityRouter.post("/:id/reject", rejectFeasibilityHandler);

feasibilityRouter.post("/:id/scores", validate(createScoreSchema), addScoreHandler);
feasibilityRouter.put("/:id/scores/:sid", validate(updateScoreSchema), updateScoreHandler);
