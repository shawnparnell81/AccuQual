import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { withSiteContext } from "../sites/siteContext.js";
import { requireDepartmentAccess } from "../../middleware/departmentAccess.js";
import { validate } from "../../middleware/validate.js";
import { createAuditSchema, updateAuditSchema, addAuditItemSchema, reorderAuditItemsSchema } from "./audits.validation.js";
import { baseHandlers, addItemHandler, listItemsHandler, reorderItemsHandler, startHandler, completeHandler } from "./audits.controller.js";

export const auditsRouter = Router();
// Turns on PERMISSION_MATRIX.audit (quality: edit) — previously unenforced.
auditsRouter.use(requireAuth, withTenantDb, withSiteContext, requireDepartmentAccess("audit"));

auditsRouter.get("/", baseHandlers.list);
auditsRouter.post("/", validate(createAuditSchema), baseHandlers.create);
auditsRouter.get("/:id", baseHandlers.getOne);
auditsRouter.patch("/:id", validate(updateAuditSchema), baseHandlers.update);
auditsRouter.get("/:id/item", listItemsHandler);
auditsRouter.post("/:id/item", validate(addAuditItemSchema), addItemHandler);
auditsRouter.post("/:id/item/reorder", validate(reorderAuditItemsSchema), reorderItemsHandler);
// Promotes Scheduled -> In Progress from generic-PATCH-only (see the
// Transitions/Rules Dictionaries) to a real, sequence-checked action.
auditsRouter.post("/:id/start", startHandler);
auditsRouter.post("/:id/complete", completeHandler);
