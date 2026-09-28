import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { rejectSupplierReads, requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { createRoleSchema, updateRoleSchema, moveRoleSchema } from "./roles.validation.js";
import { listRoles, getRole, createRole, updateRole, moveRole, deleteRole } from "./roles.controller.js";

export const rolesRouter = Router();

// Note: no withDb here — roles are platform-wide, see roles.controller.ts.
rolesRouter.use(requireAuth, rejectSupplierReads);

rolesRouter.get("/", listRoles);
rolesRouter.post("/", requireRole("admin"), validate(createRoleSchema), createRole);
rolesRouter.get("/:id", getRole);
rolesRouter.post("/:id/move", requireRole("admin"), validate(moveRoleSchema), moveRole);
rolesRouter.patch("/:id", requireRole("admin"), validate(updateRoleSchema), updateRole);
rolesRouter.delete("/:id", requireRole("admin"), deleteRole);
