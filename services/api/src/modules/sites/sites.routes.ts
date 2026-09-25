import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { withDb } from "../../lib/requestDb.js";
import { createSiteSchema, replaceMembersSchema, switchSiteSchema, updateSiteSchema } from "./sites.validation.js";
import { createHandler, getContextHandler, listMembersHandler, replaceMembersHandler, switchHandler, updateHandler } from "./sites.controller.js";

export const sitesRouter = Router();

sitesRouter.use(requireAuth, withDb);

sitesRouter.get("/", getContextHandler);
sitesRouter.post("/current", validate(switchSiteSchema), switchHandler);
sitesRouter.post("/", requireRole("admin"), validate(createSiteSchema), createHandler);
sitesRouter.get("/:id/members", requireRole("admin"), listMembersHandler);
sitesRouter.put("/:id/members", requireRole("admin"), validate(replaceMembersSchema), replaceMembersHandler);
sitesRouter.patch("/:id", requireRole("admin"), validate(updateSiteSchema), updateHandler);
