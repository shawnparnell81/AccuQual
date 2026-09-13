import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { createRmaSchema, updateRmaSchema, changeRmaStatusSchema, createRmaItemSchema, updateRmaItemSchema } from "./rma.validation.js";
import {
  listRmaHandler,
  createRmaHandler,
  getRmaHandler,
  updateRmaHandler,
  changeRmaStatusHandler,
  listRmaItemsHandler,
  createRmaItemHandler,
  updateRmaItemHandler,
} from "./rma.controller.js";

export const rmaRouter = Router();
// purchasing/material_management/quality get edit; engineering gets
// read-only — see departmentAccess.ts PERMISSION_MATRIX.rma. Finer
// per-action restrictions (create/items: purchasing+material_management
// only; quality limited to notes/linkage; status transitions gated per
// target status) are inline in rma.controller.ts, the same way
// inventory.controller.ts/erp.controller.ts guard their own per-action
// limits.
rmaRouter.use(requireAuth, withTenantDb, requireDepartmentAccess("rma"));

rmaRouter.get("/", listRmaHandler);
rmaRouter.post("/", validate(createRmaSchema), createRmaHandler);
rmaRouter.get("/:id", getRmaHandler);
rmaRouter.patch("/:id", validate(updateRmaSchema), updateRmaHandler);
rmaRouter.post("/:id/status", validate(changeRmaStatusSchema), changeRmaStatusHandler);

rmaRouter.get("/:id/items", listRmaItemsHandler);
rmaRouter.post("/:id/items", validate(createRmaItemSchema), createRmaItemHandler);
rmaRouter.patch("/:id/items/:itemId", validate(updateRmaItemSchema), updateRmaItemHandler);
