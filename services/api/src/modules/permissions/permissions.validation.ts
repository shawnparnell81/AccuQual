import { z } from "zod";
import { VISIBLE_RESOURCE_KEYS, VISIBLE_DEPARTMENTS } from "../../middleware/departmentAccess.js";

/** "No fictional modules/departments" — a company can only configure access for a module/department that's a real, fixed, already-wired value, never an arbitrary string. */
export const moduleNameSchema = z.enum(VISIBLE_RESOURCE_KEYS as [string, ...string[]]);
export const departmentNameSchema = z.enum(VISIBLE_DEPARTMENTS as [string, ...string[]]);
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

export const bulkDepartmentPermissionSchema = z.object({
  cells: z
    .array(
      z.object({
        departmentName: departmentNameSchema,
        moduleName: moduleNameSchema,
        accessLevel: accessLevelSchema,
      }),
    )
    .min(1)
    .max(400),
});

export const createPermissionRoleSchema = z.object({
  roleName: z.string().min(1).max(100),
  description: z.string().max(500).optional(),
  hierarchyLevel: z.number().int().min(1).max(1000).optional(),
});

export const updatePermissionRoleSchema = z.object({
  roleName: z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  hierarchyLevel: z.number().int().min(1).max(1000).optional(),
});

export const movePermissionRoleSchema = z.object({
  direction: z.enum(["up", "down"]),
});

export const upsertRoleModuleSchema = z.object({
  moduleName: moduleNameSchema,
  accessLevel: accessLevelSchema,
});

export const createUserRoleSchema = z.object({
  userId: z.number().int(),
  roleId: z.number().int(),
});
