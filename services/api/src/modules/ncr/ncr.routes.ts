import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { withTenantDb } from "../../lib/tenantScope.js";
import { validate } from "../../middleware/validate.js";
import {
  createNcrSchema,
  updateNcrSchema,
  assignNcrSchema,
  containmentNcrSchema,
  rootCauseNcrSchema,
  correctiveActionNcrSchema,
} from "./ncr.validation.js";
import {
  baseHandlers,
  assignHandler,
  containmentHandler,
  rootCauseHandler,
  correctiveActionHandler,
  closeHandler,
} from "./ncr.controller.js";

export const ncrRouter = Router();
ncrRouter.use(requireAuth, withTenantDb);

ncrRouter.get("/", baseHandlers.list);
ncrRouter.post("/", validate(createNcrSchema), baseHandlers.create);
ncrRouter.get("/:id", baseHandlers.getOne);
ncrRouter.patch("/:id", validate(updateNcrSchema), baseHandlers.update);

ncrRouter.post("/:id/assign", validate(assignNcrSchema), assignHandler);
ncrRouter.post("/:id/containment", validate(containmentNcrSchema), containmentHandler);
ncrRouter.post("/:id/root-cause", validate(rootCauseNcrSchema), rootCauseHandler);
ncrRouter.post("/:id/corrective-action", validate(correctiveActionNcrSchema), correctiveActionHandler);
ncrRouter.post("/:id/close", closeHandler);
