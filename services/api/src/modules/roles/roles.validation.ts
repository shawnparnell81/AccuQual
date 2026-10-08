import { z } from "zod";
import { FORM_BUILDER_PERMISSION, IMPORT_DATA_PERMISSION, RESTORE_ARCHIVED_DOCUMENTS } from "./roleAccess.js";

const permissionList = z.array(z.enum([IMPORT_DATA_PERMISSION, RESTORE_ARCHIVED_DOCUMENTS, FORM_BUILDER_PERMISSION])).max(8);

export const createRoleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(500).optional(),
  hierarchyLevel: z.number().int().min(1).max(1000).optional(),
  permissions: permissionList.optional(),
});

export const updateRoleSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().max(500).nullable().optional(),
  hierarchyLevel: z.number().int().min(1).max(1000).optional(),
  permissions: permissionList.optional(),
});

export const moveRoleSchema = z.object({
  direction: z.enum(["up", "down"]),
});

export const deleteRoleSchema = z.object({
  replacementRoleId: z.number().int().positive().optional(),
});
