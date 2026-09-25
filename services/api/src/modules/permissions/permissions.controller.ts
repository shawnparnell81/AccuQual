import type { Request, Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import {
  departmentPermissions,
  permissionRoles,
  permissionRoleModules,
  userPermissionRoles,
} from "../../drizzle/schema/permissions.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import {
  getUserAccessLevel,
  getDepartmentAccessLevel,
  MODULE_LABELS,
  RESOURCE_KEYS,
  DEPARTMENTS,
  type AccessLevel,
  type Department,
  type ResourceKey,
} from "../../middleware/departmentAccess.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import type { Db } from "../../lib/requestDb.js";

// ---------------------------------------------------------------------------
// Read endpoints open to any authenticated tenant user
// ---------------------------------------------------------------------------

/** GET /permissions/modules — the fixed, real module catalog, for populating any admin grid's columns. */
export const listModulesHandler = asyncHandler(async (_req: Request, res: Response) => {
  res.json(RESOURCE_KEYS.map((key) => ({ key, label: MODULE_LABELS[key] })));
});

/** GET /permissions/effective — the CURRENT user's own effective access to every module, computed live. This is what the frontend's button/nav gating should read instead of a static config file. */
export const getMyEffectivePermissionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const db = req.db! as Db;
  const user = { id: req.user!.id, roleName: req.user!.roleName, department: req.user!.department };

  const entries = await Promise.all(RESOURCE_KEYS.map(async (key) => [key, await getUserAccessLevel(db, user, key)] as const));
  res.json(Object.fromEntries(entries));
});

// ---------------------------------------------------------------------------
// Department Access grid — admin only
// ---------------------------------------------------------------------------

/** GET /permissions/department-permissions — the FULL department x module grid: every cell, whether it's an explicit tenant override or just the shipped default, and the row id if one exists (so the frontend never has to guess). */
export const listDepartmentPermissionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req.db!.select().from(departmentPermissions);
  const overrides = new Map(rows.map((r) => [`${r.departmentName}:${r.moduleName}`, r]));

  const grid = DEPARTMENTS.flatMap((departmentName) =>
    RESOURCE_KEYS.map((moduleName) => {
      const override = overrides.get(`${departmentName}:${moduleName}`);
      return {
        departmentName,
        moduleName,
        accessLevel: (override?.accessLevel as AccessLevel) ?? "none",
        isOverride: Boolean(override),
        id: override?.id ?? null,
      };
    })
  );
  res.json(grid);
});

/** PATCH /permissions/department-permissions — upsert ONE cell of the grid, keyed by the natural (department, module) pair the admin UI actually knows, rather than a synthetic row id it would otherwise have to look up first. */
export const upsertDepartmentPermissionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { departmentName, moduleName, accessLevel } = req.body as { departmentName: Department; moduleName: ResourceKey; accessLevel: AccessLevel };

  const [existing] = await req
    .db!.select()
    .from(departmentPermissions)
    .where(and(eq(departmentPermissions.departmentName, departmentName), eq(departmentPermissions.moduleName, moduleName)));

  const [row] = await req
    .db!.insert(departmentPermissions)
    .values({ departmentName, moduleName, accessLevel })
    .onConflictDoUpdate({
      target: [departmentPermissions.tenantId, departmentPermissions.departmentName, departmentPermissions.moduleName],
      set: { accessLevel, updatedAt: new Date() },
    })
    .returning();

  await recordAuditTrail(req.db!, {
    entityType: "DepartmentPermission",
    entityId: row!.id,
    action: existing ? "update" : "create",
    changes: { departmentName, moduleName, oldValue: existing?.accessLevel ?? "none", newValue: accessLevel },
    performedBy: req.user?.id,
  });
  res.json(row);
});

/** DELETE /permissions/department-permissions — remove an explicit override, reverting that cell back to the shipped default. Body: {departmentName, moduleName}. */
export const deleteDepartmentPermissionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { departmentName, moduleName } = req.body as { departmentName: Department; moduleName: ResourceKey };

  const [existing] = await req
    .db!.select()
    .from(departmentPermissions)
    .where(and(eq(departmentPermissions.departmentName, departmentName), eq(departmentPermissions.moduleName, moduleName)));
  if (!existing) throw AppError.notFound("DepartmentPermission");

  await req.db!.delete(departmentPermissions).where(eq(departmentPermissions.id, existing.id));
  await recordAuditTrail(req.db!, {
    entityType: "DepartmentPermission",
    entityId: existing.id,
    action: "delete",
    changes: { departmentName, moduleName, revertedTo: "none" },
    performedBy: req.user?.id,
  });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// Custom Permission Roles — admin only
// ---------------------------------------------------------------------------

/** GET /permissions/roles — every custom role this tenant has defined, with its module grants and how many users hold it. */
export const listPermissionRolesHandler = asyncHandler(async (req: Request, res: Response) => {
  const roles = await req.db!.select().from(permissionRoles);
  const moduleRows = await req.db!.select().from(permissionRoleModules);
  const memberCounts = await req
    .db!.select({ roleId: userPermissionRoles.roleId, count: sql<number>`count(*)::int` })
    .from(userPermissionRoles)
    .groupBy(userPermissionRoles.roleId);

  const countByRole = new Map(memberCounts.map((m) => [m.roleId, m.count]));
  res.json(
    roles.map((role) => ({
      ...role,
      modules: moduleRows.filter((m) => m.roleId === role.id).map((m) => ({ moduleName: m.moduleName, accessLevel: m.accessLevel })),
      memberCount: countByRole.get(role.id) ?? 0,
    }))
  );
});

export const createPermissionRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const { roleName, description } = req.body as { roleName: string; description?: string };

  const [created] = await req.db!.insert(permissionRoles).values({ roleName, description }).returning();
  await recordAuditTrail(req.db!, { entityType: "PermissionRole", entityId: created!.id, action: "create", changes: { roleName, description }, performedBy: req.user?.id });
  res.status(201).json({ ...created, modules: [], memberCount: 0 });
});

async function loadPermissionRole(req: Request, id: number) {
  const [row] = await req.db!.select().from(permissionRoles).where(and(eq(permissionRoles.id, id)));
  if (!row) throw AppError.notFound("PermissionRole");
  return row;
}

export const updatePermissionRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadPermissionRole(req, Number(req.params.id));
  const [updated] = await req
    .db!.update(permissionRoles)
    .set({ ...req.body, updatedAt: new Date() })
    .where(eq(permissionRoles.id, role.id))
    .returning();
  await recordAuditTrail(req.db!, { entityType: "PermissionRole", entityId: role.id, action: "update", changes: req.body, performedBy: req.user?.id });
  res.json(updated);
});

export const deletePermissionRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadPermissionRole(req, Number(req.params.id));
  // permissionRoleModules/userPermissionRoles both reference this role with
  // onDelete:"cascade" (see the schema's own comment) — one delete here
  // cleans up every module grant and user assignment atomically.
  await req.db!.delete(permissionRoles).where(eq(permissionRoles.id, role.id));
  await recordAuditTrail(req.db!, { entityType: "PermissionRole", entityId: role.id, action: "delete", changes: { roleName: role.roleName }, performedBy: req.user?.id });
  res.status(204).send();
});

/** PATCH /permissions/roles/:id/modules — upsert this role's access level on one module. */
export const upsertRoleModuleHandler = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadPermissionRole(req, Number(req.params.id));
  const { moduleName, accessLevel } = req.body as { moduleName: ResourceKey; accessLevel: AccessLevel };

  const [row] = await req
    .db!.insert(permissionRoleModules)
    .values({ roleId: role.id, moduleName, accessLevel })
    .onConflictDoUpdate({
      target: [permissionRoleModules.tenantId, permissionRoleModules.roleId, permissionRoleModules.moduleName],
      set: { accessLevel, updatedAt: new Date() },
    })
    .returning();

  await recordAuditTrail(req.db!, {
    entityType: "PermissionRole",
    entityId: role.id,
    action: "update",
    changes: { subAction: "module_grant_set", moduleName, accessLevel },
    performedBy: req.user?.id,
  });
  res.json(row);
});

/** DELETE /permissions/roles/:id/modules/:moduleName — remove this role's grant on one module (it contributes "none" from this source afterward). */
export const deleteRoleModuleHandler = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadPermissionRole(req, Number(req.params.id));
  const moduleName = req.params.moduleName as ResourceKey;

  const deleted = await req
    .db!.delete(permissionRoleModules)
    .where(and(eq(permissionRoleModules.roleId, role.id), eq(permissionRoleModules.moduleName, moduleName)))
    .returning();
  if (deleted.length === 0) throw AppError.notFound("PermissionRoleModule");

  await recordAuditTrail(req.db!, {
    entityType: "PermissionRole",
    entityId: role.id,
    action: "update",
    changes: { subAction: "module_grant_removed", moduleName },
    performedBy: req.user?.id,
  });
  res.status(204).send();
});

// ---------------------------------------------------------------------------
// User <-> Permission Role assignment — admin only
// ---------------------------------------------------------------------------

/** GET /permissions/user-roles — every assignment in this tenant, with enough joined user/role info for the User Assignment page to render without extra round-trips. */
export const listUserRolesHandler = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req
    .db!.select({
      id: userPermissionRoles.id,
      userId: userPermissionRoles.userId,
      userEmail: users.email,
      userName: users.name,
      roleId: userPermissionRoles.roleId,
      roleName: permissionRoles.roleName,
      createdAt: userPermissionRoles.createdAt,
    })
    .from(userPermissionRoles)
    .innerJoin(users, eq(users.id, userPermissionRoles.userId))
    .innerJoin(permissionRoles, eq(permissionRoles.id, userPermissionRoles.roleId));
  res.json(rows);
});

export const createUserRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const { userId, roleId } = req.body as { userId: number; roleId: number };

  const [targetUser] = await req.db!.select({ id: users.id }).from(users).where(and(eq(users.id, userId)));
  if (!targetUser) throw AppError.badRequest(`User #${userId} not found in this tenant`);
  await loadPermissionRole(req, roleId);

  const [row] = await req.db!.insert(userPermissionRoles).values({ userId, roleId }).onConflictDoNothing().returning();
  const finalRow = row ?? (await req.db!.select().from(userPermissionRoles).where(and(eq(userPermissionRoles.userId, userId), eq(userPermissionRoles.roleId, roleId))))[0];

  await recordAuditTrail(req.db!, {
    entityType: "UserPermissionRole",
    entityId: finalRow!.id,
    action: "create",
    changes: { userId, roleId },
    performedBy: req.user?.id,
  });
  res.status(201).json(finalRow);
});

export const deleteUserRoleHandler = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [existing] = await req.db!.select().from(userPermissionRoles).where(and(eq(userPermissionRoles.id, id)));
  if (!existing) throw AppError.notFound("UserPermissionRole");

  await req.db!.delete(userPermissionRoles).where(eq(userPermissionRoles.id, id));
  await recordAuditTrail(req.db!, {
    entityType: "UserPermissionRole",
    entityId: id,
    action: "delete",
    changes: { userId: existing.userId, roleId: existing.roleId },
    performedBy: req.user?.id,
  });
  res.status(204).send();
});

/** GET /permissions/users/:userId/effective — the full per-module breakdown for one user: their real effective level (department baseline, custom-role grants, and the admin bypass, exactly as getUserAccessLevel computes it everywhere else in the app) plus, for transparency, the department-only baseline so an admin can see how much of that level (if any) came from a custom role grant. */
export const getUserEffectivePermissionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const userId = Number(req.params.userId);
  const db = req.db! as Db;

  const [targetUser] = await db
    .select({ id: users.id, email: users.email, department: users.department, roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(roles.id, users.roleId))
    .where(and(eq(users.id, userId)));
  if (!targetUser) throw AppError.notFound("User");

  const breakdown = await Promise.all(
    RESOURCE_KEYS.map(async (moduleName) => {
      const [effectiveLevel, departmentLevel] = await Promise.all([
        getUserAccessLevel(db, targetUser, moduleName),
        getDepartmentAccessLevel(db, targetUser.department as Department | null, moduleName),
      ]);
      return { moduleName, label: MODULE_LABELS[moduleName], departmentLevel, effectiveLevel };
    })
  );
  res.json({ userId: targetUser.id, email: targetUser.email, department: targetUser.department, roleName: targetUser.roleName, breakdown });
});
