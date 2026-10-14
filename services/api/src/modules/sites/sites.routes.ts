import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRolePermission } from "../../middleware/rbac.js";
import { ADMIN_CONSOLE_PERMISSION } from "../roles/roleAccess.js";
import { validate } from "../../middleware/validate.js";
import { withDb } from "../../lib/requestDb.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { changeRecordSiteSchema, createSiteSchema, replaceMembersSchema, switchSiteSchema, updateSiteSchema } from "./sites.validation.js";
import { changeRecordSiteHandler, createHandler, deleteHandler, getContextHandler, getRecordSiteHandler, listMembersHandler, replaceMembersHandler, switchHandler, updateHandler } from "./sites.controller.js";
import { callerCanDeletePlants } from "./sites.service.js";

export const sitesRouter = Router();

sitesRouter.use(requireAuth, withDb);

const requirePlantDelete = asyncHandler(async (req, _res, next) => {
  if (!req.db || !req.user) return next(AppError.forbidden("Not signed in"));
  const allowed = await callerCanDeletePlants(req.db, req.user.roleName);
  if (!allowed) return next(AppError.forbidden("You don't have permission to delete plants."));
  next();
});

sitesRouter.get("/", getContextHandler);
sitesRouter.post("/current", validate(switchSiteSchema), switchHandler);
sitesRouter.get("/record", getRecordSiteHandler);
sitesRouter.patch("/record", validate(changeRecordSiteSchema), changeRecordSiteHandler);
sitesRouter.post("/", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(createSiteSchema), createHandler);
sitesRouter.get("/:id/members", requireRolePermission(ADMIN_CONSOLE_PERMISSION), listMembersHandler);
sitesRouter.put("/:id/members", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(replaceMembersSchema), replaceMembersHandler);
sitesRouter.patch("/:id", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateSiteSchema), updateHandler);
sitesRouter.delete("/:id", requirePlantDelete, deleteHandler);
