import type { Request, Response } from "express";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { company } from "../../drizzle/schema/company.js";
import { roles } from "../../drizzle/schema/roles.js";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { ROLES_MANAGE_PERMISSION } from "./roleAccess.js";
import { deletedRoleNames, withDeletedRole, withoutDeletedRole, type DeletedSystemRole } from "./deletedSystemRoles.js";
import { decideRoleDeletion, displayNameForRole, hierarchyLevelForRoleName, moveRank, PROTECTED_ROLE_NAMES, roleIsProtected } from "./roleHierarchy.js";
import { permissionDiff } from "./permissionDiff.js";
import { deleteRoleSchema } from "./roles.validation.js";

async function loadCompanyProfile() {
  const [row] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  return row ?? null;
}

async function deletedRoles(): Promise<DeletedSystemRole[]> {
  const row = await loadCompanyProfile();
  return row?.profile?.deletedSystemRoles ?? [];
}

/** Owner and Administrator receive role management once. Taking it off later stays off. */
async function ensureDefaultRoleManagement(): Promise<void> {
  const row = await loadCompanyProfile();
  if (!row || row.profile?.rolesManageGranted) return;
  const builtIn = await db.select().from(roles).where(inArray(roles.name, ["owner", "admin"]));
  for (const role of builtIn) {
    const permissions = role.permissions ?? [];
    if (permissions.includes(ROLES_MANAGE_PERMISSION)) continue;
    await db.update(roles).set({ permissions: [...permissions, ROLES_MANAGE_PERMISSION] }).where(eq(roles.id, role.id));
  }
  await db.update(company).set({ profile: { ...(row.profile ?? {}), rolesManageGranted: true } }).where(eq(company.id, row.id));
}

async function assertCanManageRoles(req: Request): Promise<void> {
  await ensureDefaultRoleManagement();
  const roleName = req.user?.roleName;
  if (!roleName) throw AppError.forbidden("You need the role-management permission to delete a role.");
  const [role] = await db.select({ permissions: roles.permissions }).from(roles).where(eq(roles.name, roleName));
  if (!(role?.permissions ?? []).includes(ROLES_MANAGE_PERMISSION)) {
    throw AppError.forbidden("You need the role-management permission to delete a role.");
  }
}

async function loadRole(id: number) {
  const [role] = await db.select().from(roles).where(eq(roles.id, id));
  if (!role) throw AppError.notFound("Role");
  return role;
}

async function userCount(roleId: number): Promise<number> {
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.roleId, roleId));
  return row?.count ?? 0;
}

async function roleCounts() {
  const counts = await db
    .select({ roleId: users.roleId, count: sql<number>`count(*)::int` })
    .from(users)
    .groupBy(users.roleId);
  return new Map(counts.map((row) => [row.roleId, row.count]));
}

export const listRoles = asyncHandler(async (_req: Request, res: Response) => {
  await ensureDefaultRoleManagement();
  const hidden = deletedRoleNames(await deletedRoles());
  const rows = await db.select().from(roles).orderBy(asc(roles.hierarchyLevel), asc(roles.name));
  const countByRole = await roleCounts();
  res.json(rows.filter((role) => !hidden.has(role.name)).map((role) => ({ ...role, displayName: displayNameForRole(role), userCount: countByRole.get(role.id) ?? 0 })));
});

export const listDeletedRoles = asyncHandler(async (req: Request, res: Response) => {
  await assertCanManageRoles(req);
  const tombstones = await deletedRoles();
  const hidden = deletedRoleNames(tombstones);
  const rows = await db.select().from(roles).orderBy(asc(roles.hierarchyLevel), asc(roles.name));
  const byName = new Map(tombstones.map((row) => [row.name, row]));
  res.json(
    rows
      .filter((role) => hidden.has(role.name))
      .map((role) => ({
        ...role,
        displayName: displayNameForRole(role),
        deletedAt: byName.get(role.name)?.deletedAt ?? null,
        deletedBy: byName.get(role.name)?.deletedBy ?? null,
        reason: byName.get(role.name)?.reason ?? null,
      })),
  );
});

export const getRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadRole(Number(req.params.id));
  if (deletedRoleNames(await deletedRoles()).has(role.name)) throw AppError.notFound("Role");
  res.json({ ...role, displayName: displayNameForRole(role), userCount: await userCount(role.id) });
});

export const createRole = asyncHandler(async (req: Request, res: Response) => {
  const body = req.body as { name: string; description?: string; hierarchyLevel?: number; permissions?: string[] };
  const normalized = body.name.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (PROTECTED_ROLE_NAMES.has(normalized)) {
    throw AppError.badRequest("That name is reserved for a built-in role.");
  }
  const hierarchyLevel = body.hierarchyLevel ?? hierarchyLevelForRoleName(body.name);
  const [created] = await db
    .insert(roles)
    .values({ name: body.name.trim(), description: body.description, hierarchyLevel, isProtected: false, permissions: body.permissions ?? [] })
    .returning();
  if (!created) throw new AppError("Failed to create role", 500);
  await recordAuditTrail(db, { entityType: "Role", entityId: created.id, action: "create", changes: { name: created.name, hierarchyLevel, permissions: created.permissions }, performedBy: req.user?.id });
  res.status(201).json({ ...created, displayName: displayNameForRole(created), userCount: 0 });
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
  const diff = body.permissions !== undefined ? permissionDiff(role.permissions ?? [], body.permissions) : { granted: [] as string[], revoked: [] as string[] };
  const changes: Record<string, unknown> = {};
  if (patch.name !== undefined && patch.name !== role.name) changes.name = { from: role.name, to: patch.name };
  if (patch.description !== undefined && patch.description !== role.description) changes.description = { from: role.description, to: patch.description };
  if (patch.hierarchyLevel !== undefined && patch.hierarchyLevel !== role.hierarchyLevel) changes.hierarchyLevel = { from: role.hierarchyLevel, to: patch.hierarchyLevel };
  if (diff.granted.length > 0 || diff.revoked.length > 0) {
    changes.roleName = role.name;
    changes.bulk = diff.granted.length + diff.revoked.length > 1;
    changes.permissions = { granted: diff.granted, revoked: diff.revoked };
  }
  if (Object.keys(changes).length > 0) {
    await recordAuditTrail(db, { entityType: "Role", entityId: role.id, action: "update", changes, performedBy: req.user?.id });
  }
  res.json({ ...updated, displayName: displayNameForRole(updated), userCount: await userCount(role.id) });
});

export const moveRole = asyncHandler(async (req: Request, res: Response) => {
  const role = await loadRole(Number(req.params.id));
  const { direction } = req.body as { direction: "up" | "down" };
  const hidden = deletedRoleNames(await deletedRoles());
  const ordered = (await db.select({ id: roles.id, name: roles.name, hierarchyLevel: roles.hierarchyLevel }).from(roles).orderBy(asc(roles.hierarchyLevel), asc(roles.name))).filter((role) => !hidden.has(role.name));
  const changes = moveRank(ordered, role.id, direction);
  if (changes.length === 0) {
    res.json({ ...role, displayName: displayNameForRole(role), userCount: await userCount(role.id) });
    return;
  }
  for (const change of changes) {
    await db.update(roles).set({ hierarchyLevel: change.hierarchyLevel }).where(eq(roles.id, change.id));
  }
  const updated = await loadRole(role.id);
  await recordAuditTrail(db, { entityType: "Role", entityId: role.id, action: "update", changes: { hierarchyLevel: updated.hierarchyLevel, moved: direction }, performedBy: req.user?.id });
  res.json({ ...updated, displayName: displayNameForRole(updated), userCount: await userCount(role.id) });
});

export const deleteRole = asyncHandler(async (req: Request, res: Response) => {
  await assertCanManageRoles(req);
  const role = await loadRole(Number(req.params.id));
  const hidden = deletedRoleNames(await deletedRoles());
  if (hidden.has(role.name)) throw AppError.notFound("Role");
  const parsed = deleteRoleSchema.safeParse(req.body ?? {});
  const fromBody = parsed.success ? parsed.data.replacementRoleId : undefined;
  const reason = parsed.success ? parsed.data.reason : undefined;
  const replacementRaw = fromBody ?? (req.query.replacementRoleId ? Number(req.query.replacementRoleId) : undefined);
  const replacementRoleId = replacementRaw != null && Number.isFinite(Number(replacementRaw)) ? Number(replacementRaw) : undefined;
  const holders = await userCount(role.id);
  let replacement: typeof role | undefined;
  if (replacementRoleId != null) {
    const [found] = await db.select().from(roles).where(eq(roles.id, replacementRoleId));
    replacement = found;
  }
  const visible = (await db.select({ id: roles.id, name: roles.name, permissions: roles.permissions }).from(roles)).filter((row) => !hidden.has(row.name) && row.id !== role.id);
  const manages = (permissions: string[] | null | undefined) => (permissions ?? []).includes(ROLES_MANAGE_PERMISSION);
  const decision = decideRoleDeletion({
    displayName: displayNameForRole(role),
    userCount: holders,
    replacementRoleId,
    replacementExists: replacement != null,
    replacementIsSameRole: replacementRoleId === role.id,
    replacementIsDeleted: replacement != null && hidden.has(replacement.name),
    roleManagesRoles: manages(role.permissions),
    otherRoleManagesRoles: visible.some((row) => manages(row.permissions)),
    replacementManagesRoles: manages(replacement?.permissions),
    callerHoldsRole: req.user?.roleId != null && req.user.roleId === role.id,
  });
  if (!decision.ok) throw new AppError(decision.message, decision.status, { userCount: holders, requiresReplacement: holders > 0 });

  const companyRow = await loadCompanyProfile();
  if (!companyRow) throw new AppError("This installation has no company yet.", 409);
  const tombstone: DeletedSystemRole = {
    name: role.name,
    deletedAt: new Date().toISOString(),
    deletedBy: req.user?.id ?? null,
    reason: reason?.trim() ? reason.trim() : null,
  };
  await db.transaction(async (tx) => {
    if (decision.reassign && replacement) {
      await tx.update(users).set({ roleId: replacement.id, updatedAt: new Date() }).where(eq(users.roleId, role.id));
    }
    await tx.update(company).set({ profile: { ...(companyRow.profile ?? {}), deletedSystemRoles: withDeletedRole(companyRow.profile?.deletedSystemRoles, tombstone) } }).where(eq(company.id, companyRow.id));
    await recordAuditTrail(tx, {
      entityType: "Role",
      entityId: role.id,
      action: "delete",
      changes: { name: role.name, displayName: displayNameForRole(role), softDeleted: true, reassignedTo: replacement?.name ?? null, userCount: holders, reason: tombstone.reason },
      performedBy: req.user?.id,
    });
  });
  res.status(204).send();
});

export const restoreRole = asyncHandler(async (req: Request, res: Response) => {
  await assertCanManageRoles(req);
  const role = await loadRole(Number(req.params.id));
  const companyRow = await loadCompanyProfile();
  const hidden = deletedRoleNames(companyRow?.profile?.deletedSystemRoles);
  if (!companyRow || !hidden.has(role.name)) throw AppError.notFound("Role");
  await db.transaction(async (tx) => {
    await tx.update(company).set({ profile: { ...(companyRow.profile ?? {}), deletedSystemRoles: withoutDeletedRole(companyRow.profile?.deletedSystemRoles, role.name) } }).where(eq(company.id, companyRow.id));
    await recordAuditTrail(tx, {
      entityType: "Role",
      entityId: role.id,
      action: "update",
      changes: { name: role.name, displayName: displayNameForRole(role), restored: true },
      performedBy: req.user?.id,
    });
  });
  res.json({ ...role, displayName: displayNameForRole(role), userCount: await userCount(role.id) });
});
