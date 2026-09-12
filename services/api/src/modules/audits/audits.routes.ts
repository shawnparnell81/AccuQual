import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import { createAuditSchema, updateAuditSchema, addAuditItemSchema } from "./audits.validation.js";
import { baseHandlers, addItemHandler, listItemsHandler, completeHandler } from "./audits.controller.js";

export const auditsRouter = Router();
auditsRouter.use(requireAuth, withTenantDb);

auditsRouter.get("/", baseHandlers.list);
auditsRouter.post("/", validate(createAuditSchema), baseHandlers.create);
auditsRouter.get("/:id", baseHandlers.getOne);
auditsRouter.patch("/:id", validate(updateAuditSchema), baseHandlers.update);
auditsRouter.get("/:id/item", listItemsHandler);
auditsRouter.post("/:id/item", validate(addAuditItemSchema), addItemHandler);
auditsRouter.post("/:id/complete", completeHandler);
