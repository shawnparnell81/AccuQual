import { z } from "zod";
import { RESOURCE_KEYS, DEPARTMENTS } from "../../middleware/departmentAccess.js";

/** "No fictional modules/departments" — a tenant can only configure access for a module/department that's a real, fixed, already-wired value, never an arbitrary string. */
export const moduleNameSchema = z.enum(RESOURCE_KEYS as [string, ...string[]]);
export const departmentNameSchema = z.enum(DEPARTMENTS as [string, ...string[]]);
export const accessLevelSchema = z.enum(["none", "read", "edit"]);

export const upsertDepartmentPermissionSchema = z.object({
  departmentName: departmentNameSchema,
  moduleName: moduleNameSchema,
  accessLevel: accessLevelSchema,
});

export const deleteDepartmentPermissionSchema = z.object({
  departmentName: departmentNameSchema,
  moduleName: moduleNameSchema,
});

export const createPermissionRoleSchema = z.object({
  roleName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
});

export const updatePermissionRoleSchema = z.object({
  roleName: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
});

export const upsertRoleModuleSchema = z.object({
  moduleName: moduleNameSchema,
  accessLevel: accessLevelSchema,
});

export const createUserRoleSchema = z.object({
  userId: z.number().int(),
  roleId: z.number().int(),
});
