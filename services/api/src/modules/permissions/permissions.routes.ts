import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireRole } from "../../middleware/rbac.js";
import { withDb } from "../../lib/requestDb.js";
import { validate } from "../../middleware/validate.js";
import {
  upsertDepartmentPermissionSchema,
  deleteDepartmentPermissionSchema,
  createPermissionRoleSchema,
  updatePermissionRoleSchema,
  upsertRoleModuleSchema,
  createUserRoleSchema,
} from "./permissions.validation.js";
import {
  listModulesHandler,
  getMyEffectivePermissionsHandler,
  listDepartmentPermissionsHandler,
  upsertDepartmentPermissionHandler,
  deleteDepartmentPermissionHandler,
  listPermissionRolesHandler,
  createPermissionRoleHandler,
  updatePermissionRoleHandler,
  deletePermissionRoleHandler,
  upsertRoleModuleHandler,
  deleteRoleModuleHandler,
  listUserRolesHandler,
  createUserRoleHandler,
  deleteUserRoleHandler,
  getUserEffectivePermissionsHandler,
} from "./permissions.controller.js";

export const permissionsRouter = Router();
permissionsRouter.use(requireAuth, withDb);

// Open to any authenticated company user — reading your OWN effective access
// (or the fixed module catalog) isn't a configuration action.
permissionsRouter.get("/modules", listModulesHandler);
permissionsRouter.get("/effective", getMyEffectivePermissionsHandler);

// Everything below configures company-wide access control — admin only,
// same as every other company-config surface in this app (settings.routes.ts,
// AdminOnlyGuard-backed pages).
permissionsRouter.use(requireRole("admin"));

permissionsRouter.get("/department-permissions", listDepartmentPermissionsHandler);
permissionsRouter.patch("/department-permissions", validate(upsertDepartmentPermissionSchema), upsertDepartmentPermissionHandler);
permissionsRouter.delete("/department-permissions", validate(deleteDepartmentPermissionSchema), deleteDepartmentPermissionHandler);

permissionsRouter.get("/roles", listPermissionRolesHandler);
permissionsRouter.post("/roles", validate(createPermissionRoleSchema), createPermissionRoleHandler);
permissionsRouter.patch("/roles/:id", validate(updatePermissionRoleSchema), updatePermissionRoleHandler);
permissionsRouter.delete("/roles/:id", deletePermissionRoleHandler);
permissionsRouter.patch("/roles/:id/modules", validate(upsertRoleModuleSchema), upsertRoleModuleHandler);
permissionsRouter.delete("/roles/:id/modules/:moduleName", deleteRoleModuleHandler);

permissionsRouter.get("/user-roles", listUserRolesHandler);
permissionsRouter.post("/user-roles", validate(createUserRoleSchema), createUserRoleHandler);
permissionsRouter.delete("/user-roles/:id", deleteUserRoleHandler);

permissionsRouter.get("/users/:userId/effective", getUserEffectivePermissionsHandler);
