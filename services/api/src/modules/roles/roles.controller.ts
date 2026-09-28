import type { Request, Response } from "express";
import { asc, eq, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { roles } from "../../drizzle/schema/roles.js";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { isFullAccessRole } from "./roleAccess.js";
import { decideRoleDeletion, hierarchyLevelForRoleName, moveRank, roleIsProtected } from "./roleHierarchy.js";
import { deleteRoleSchema } from "./roles.validation.js";

async function loadRole(id: number) {
  const [role] = await db.select().from(roles).where(eq(roles.id, id));
  if (!role) throw AppError.notFound("Role");
  return role;
}

async function userCount(roleId: number): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.roleId, roleId));
  return row?.count ?? 0;
}

async function otherFullAccess(exceptRoleId: number): Promise<number> {
  const rows = await db
    .select({ id: users.id, roleName: roles.name, isActive: users.isActive, roleId: users.roleId })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id));
  return rows.filter((row) => row.isActive && row.roleId !== exceptRoleId && isFullAccessRole(row.roleName)).length;
}

export const listRoles = asyncHandler(async (_req: Request, res: Response) => {
  const rows = await db.select().from(roles).orderBy(asc(roles.hierarchyLevel), asc(roles.name));
  const counts = await db
    .select({ roleId: users.roleId, count: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.roleId);
  const countByRole = new Map(counts.map((row) => [row.roleId, row.count]));
  res.json(rows.map((role) => ({ ...role, userCount: countByRole.get(role.id) ?? 0 })));
});

export const getRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadRole(Number(req.params.id));
  res.json({ ...role, userCount: await userCount(role.id) });
});

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { name: string; description?: string; hierarchyLevel?: number; permissions?: string[] };
  const normalized = body.name.trim().toLowerCase().replace(/\s+/g, "_");
  if (["owner", "admin", "president", "vice_president", "quality_manager", "auditor", "operator", "supplier", "customer"].includes(normalized)) {
    throw AppError.badRequest("That name is reserved for a built-in role.");
  }
  const hierarchyLevel = body.hierarchyLevel ?? hierarchyLevelForRoleName(body.name);
  const [created] = await db
    .insert(roles)
    .values({ name: body.name.trim(), description: body.description, hierarchyLevel, isProtected: false, permissions: body.permissions ?? [] })
    .returning();
  if (!created) throw new AppError("Failed to create role", 500);
  await recordAuditTrail(db, { entityType: "Role", entityId: created.id, action: "create", changes: { name: created.name, hierarchyLevel, permissions: created.permissions }, performedBy: req.user?.id });
  res.status(201).json({ ...created, userCount: 0 });
});

export const updateRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadRole(Number(req.params.id));
  const body = req.body as { name?: string; description?: string | null; hierarchyLevel?: number; permissions?: string[] };
  if (body.name !== undefined && body.name.trim() !== role.name && roleIsProtected(role)) {
    throw AppError.badRequest("This role's name is built in and can't be changed.");
  }
  const patch: { name?: string; description?: string | null; hierarchyLevel?: number; permissions?: string[] } = {};
  if (body.name !== undefined) patch.name = body.name.trim();
  if (body.description !== undefined) patch.description = body.description;
  if (body.hierarchyLevel !== undefined) patch.hierarchyLevel = body.hierarchyLevel;
  if (body.permissions !== undefined) patch.permissions = body.permissions;
  const [updated] = await db.update(roles).set(patch).where(eq(roles.id, role.id)).returning();
  if (!updated) throw AppError.notFound("Role");
  await recordAuditTrail(db, { entityType: "Role", entityId: role.id, action: "update", changes: patch, performedBy: req.user?.id });
  res.json({ ...updated, userCount: await userCount(role.id) });
});

export const moveRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadRole(Number(req.params.id));
  const { direction } = req.body as { direction: "up" | "down" };
  const ordered = await db.select({ id: roles.id, hierarchyLevel: roles.hierarchyLevel }).from(roles).orderBy(asc(roles.hierarchyLevel), asc(roles.name));
  const changes = moveRank(ordered, role.id, direction);
  if (changes.length === 0) {
    res.json({ ...role, userCount: await userCount(role.id) });
    return;
  }
  for (const change of changes) {
    await db.update(roles).set({ hierarchyLevel: change.hierarchyLevel }).where(eq(roles.id, change.id));
  }
  const updated = await loadRole(role.id);
  await recordAuditTrail(db, { entityType: "Role", entityId: role.id, action: "update", changes: { hierarchyLevel: updated.hierarchyLevel, moved: direction }, performedBy: req.user?.id });
  res.json({ ...updated, userCount: await userCount(role.id) });
});

export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadRole(Number(req.params.id));
  const parsed = deleteRoleSchema.safeParse(req.body ?? {});
  const fromBody = parsed.success ? parsed.data.replacementRoleId : undefined;
  const replacementRaw = fromBody ?? (req.query.replacementRoleId ? Number(req.query.replacementRoleId) : undefined);
  const replacementRoleId = replacementRaw != null && Number.isFinite(Number(replacementRaw)) ? Number(replacementRaw) : undefined;
  const holders = await userCount(role.id);
  let replacement: typeof role | undefined;
  if (replacementRoleId != null) {
    const [found] = await db.select().from(roles).where(eq(roles.id, replacementRoleId));
    replacement = found;
  }
  const decision = decideRoleDeletion({
    roleName: role.name,
    isProtected: roleIsProtected(role),
    userCount: holders,
    replacementRoleId,
    replacementExists: replacementRoleId == null || replacement != null,
    replacementIsSameRole: replacementRoleId === role.id,
    roleIsFullAccess: isFullAccessRole(role.name),
    replacementIsFullAccess: isFullAccessRole(replacement?.name),
    otherActiveFullAccessUsers: await otherFullAccess(role.id),
  });
  if (!decision.ok) throw new AppError(decision.message, decision.status, { userCount: holders, requiresReplacement: holders > 0 });

  await db.transaction(async (tx) => {
    if (decision.reassign && replacement) {
      await tx.update(users).set({ roleId: replacement.id, updatedAt: new Date() }).where(eq(users.roleId, role.id));
    }
    await tx.delete(roles).where(eq(roles.id, role.id));
    await recordAuditTrail(tx, {
      entityType: "Role",
      entityId: role.id,
      action: "delete",
      changes: { name: role.name, reassignedTo: replacement?.name ?? null, userCount: holders },
      performedBy: req.user?.id,
    });
  });
  res.status(204).send();
});
