import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createFeasibilitySchema, updateFeasibilitySchema, updateSignoffSchema } from "./feasibility.validation.js";
import {
  listFeasibilityHandler,
  createFeasibilityHandler,
  getFeasibilityHandler,
  updateFeasibilityHandler,
  updateSignoffHandler,
  finalizeFeasibilityHandler,
  deleteFeasibilityHandler,
} from "./feasibility.controller.js";

export const feasibilityRouter = Router();
// engineering owns the document (create/update/finalize/delete, enforced
// inline in feasibility.controller.ts's assertDepartment); quality/
// production/purchasing/sales_and_marketing get "edit" here too because
// each owns exactly one sign-off row (PATCH /:id/signoff), narrowed inline
// by assertSignoffFieldsAllowed — same "matrix grants edit, controller
// narrows the real per-action rule" pattern as risk/rma/work_orders. See
// departmentAccess.ts PERMISSION_MATRIX.feasibility.
//
// No dedicated AI endpoint on this router by design — per the module's own
// locked decision, Feasibility AI routes through the generic
// POST /ai/assistant (context.module = "feasibility"), not a bespoke
// pipeline. See ai.assistant.ts's loadContextSummary for the "feasibility"
// case.
feasibilityRouter.use(requireAuth, withDb, requireDepartmentAccess("feasibility"));

feasibilityRouter.get("/", listFeasibilityHandler);
feasibilityRouter.post("/", validate(createFeasibilitySchema), createFeasibilityHandler);
feasibilityRouter.get("/:id", getFeasibilityHandler);
feasibilityRouter.put("/:id", validate(updateFeasibilitySchema), updateFeasibilityHandler);
feasibilityRouter.patch("/:id/signoff", validate(updateSignoffSchema), updateSignoffHandler);
feasibilityRouter.post("/:id/finalize", finalizeFeasibilityHandler);
feasibilityRouter.delete("/:id", deleteFeasibilityHandler);
