import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createRequisitionSchema, updateRequisitionSchema } from "./erp.validation.js";
import {
  listRequisitionsHandler,
  createRequisitionHandler,
  getRequisitionHandler,
  updateRequisitionHandler,
  submitRequisitionHandler,
  approveRequisitionHandler,
  rejectRequisitionHandler,
  convertRequisitionToPoHandler,
} from "./erp.controller.js";
import { requisitionAiJustifyHandler } from "./requisition.ai.js";

/**
 * A separate router (not folded into erpRouter) mounted at /erp/requisitions
 * — deliberately, because it needs a different department gate.
 * requireDepartmentAccess("erp") only grants purchasing/material_management/
 * quality (see departmentAccess.ts), but any requesting department
 * (production/engineering included) must be able to raise a requisition —
 * see PERMISSION_MATRIX.purchase_requisitions. Registered before erpRouter
 * in routes/index.ts so these paths are matched here first. Approve/reject/
 * convert-to-po are purchasing-only, enforced inline in erp.controller.ts.
 */
export const erpRequisitionsRouter = Router();
erpRequisitionsRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("purchase_requisitions"));

erpRequisitionsRouter.get("/", listRequisitionsHandler);
erpRequisitionsRouter.post("/", validate(createRequisitionSchema), createRequisitionHandler);
erpRequisitionsRouter.get("/:id", getRequisitionHandler);
erpRequisitionsRouter.patch("/:id", validate(updateRequisitionSchema), updateRequisitionHandler);
erpRequisitionsRouter.post("/:id/ai-justify", requisitionAiJustifyHandler);
erpRequisitionsRouter.post("/:id/submit", submitRequisitionHandler);
erpRequisitionsRouter.post("/:id/approve", approveRequisitionHandler);
erpRequisitionsRouter.post("/:id/reject", rejectRequisitionHandler);
erpRequisitionsRouter.post("/:id/convert-to-po", convertRequisitionToPoHandler);
