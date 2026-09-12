import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { validate } from "../../middleware/validate.js";
import { createRoleSchema, updateRoleSchema } from "./roles.validation.js";
import { listRoles, getRole, createRole, updateRole } from "./roles.controller.js";

export const rolesRouter = Router();

// Note: no withTenantDb here — roles are platform-wide, see roles.controller.ts.
rolesRouter.use(requireAuth);

rolesRouter.get("/", listRoles);
rolesRouter.post("/", requireRole("admin"), validate(createRoleSchema), createRole);
rolesRouter.get("/:id", getRole);
rolesRouter.patch("/:id", requireRole("admin"), validate(updateRoleSchema), updateRole);
