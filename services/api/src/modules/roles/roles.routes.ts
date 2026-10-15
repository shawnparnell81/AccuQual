import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { rejectSupplierReads, requireRolePermission } from "../../middleware/rbac.js";
import { ADMIN_CONSOLE_PERMISSION } from "./roleAccess.js";
import { validate } from "../../middleware/validate.js";
import { createRoleSchema, updateRoleSchema, moveRoleSchema } from "./roles.validation.js";
import { listRoles, listDeletedRoles, getRole, createRole, updateRole, moveRole, deleteRole, restoreRole } from "./roles.controller.js";

export const rolesRouter = Router();

// Note: no withDb here — roles are platform-wide, see roles.controller.ts.
rolesRouter.use(requireAuth, rejectSupplierReads);

rolesRouter.get("/", listRoles);
rolesRouter.get("/deleted", listDeletedRoles);
rolesRouter.post("/", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(createRoleSchema), createRole);
rolesRouter.get("/:id", getRole);
rolesRouter.post("/:id/move", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(moveRoleSchema), moveRole);
rolesRouter.patch("/:id", requireRolePermission(ADMIN_CONSOLE_PERMISSION), validate(updateRoleSchema), updateRole);
rolesRouter.delete("/:id", deleteRole);
rolesRouter.post("/:id/restore", restoreRole);
