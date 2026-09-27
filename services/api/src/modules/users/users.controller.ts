import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { and, eq, ne, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { refreshTokens } from "../../drizzle/schema/refreshTokens.js";
import { trustedDevices } from "../../drizzle/schema/trustedDevices.js";
import { mfaRecoveryCodes } from "../../drizzle/schema/mfaRecoveryCodes.js";
import { passwordResetTokens } from "../../drizzle/schema/passwordResetTokens.js";
import { userIdentities } from "../../drizzle/schema/sso.js";
import { userPermissionRoles } from "../../drizzle/schema/permissions.js";
import { userSites } from "../../drizzle/schema/sites.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { revokeRefreshTokenRows } from "../auth/auth.service.js";
import { revokeAllTrustedDevices } from "../auth/trustedDevice.service.js";
import { clearMfa } from "../auth/mfa.service.js";
import { assertPasswordAcceptable } from "../../utils/passwordPolicy.js";
import { isFullAccessRole } from "../roles/roleAccess.js";
import { decideUserRemoval } from "./userRemoval.js";
import { loadUserHistory } from "./userLinks.js";
import type { Db } from "../../lib/requestDb.js";

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req
    .db!.select({
      id: users.id,
      email: users.email,
      name: users.name,
      roleId: users.roleId,
      department: users.department,
      managerId: users.managerId,
      isActive: users.isActive,
      mfaEnabled: users.mfaEnabled,
      lockedUntil: users.lockedUntil,
      createdAt: users.createdAt,
    })
    .from(users);
  res.json(rows);
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req
    .db!.select({
      id: users.id,
      email: users.email,
      name: users.name,
      roleId: users.roleId,
      department: users.department,
      managerId: users.managerId,
      isActive: users.isActive,
      createdAt: users.createdAt,
    })
    .from(users)
    .where(and(eq(users.id, Number(req.params.id))));
  if (!row) throw AppError.notFound("User");
  res.json(row);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name, roleId, department } = req.body;
  await assertPasswordAcceptable(password, { email, name });
  const passwordHash = await bcrypt.hash(password, 10);
  const [created] = await req.db!.insert(users).values({ email, passwordHash, name, roleId, department, passwordChangedAt: new Date(), mustChangePassword: true }).returning();
  if (!created) throw new AppError("Failed to create user", 500);
  const { passwordHash: _omit, ...safe } = created;
  res.status(201).json(safe);
});

async function otherActiveFullAccess(db: Db, exceptUserId: number): Promise<number> {
  const rows = await db
    .select({ id: users.id, isActive: users.isActive, roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(ne(users.id, exceptUserId));
  return rows.filter((row) => row.isActive && isFullAccessRole(row.roleName)).length;
}

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [before] = await req
    .db!.select({ roleId: users.roleId, roleName: roles.name, department: users.department, isActive: users.isActive, email: users.email })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id));
  if (!before) throw AppError.notFound("User");
  // Disabling a user, or changing what they may do, ends their current sessions: bumping token_version makes requireAuth refuse their access token on the very next request and blocks every refresh token. They sign in again and get the new permissions.
  const body = req.body as { name?: string; email?: string; roleId?: number | null; department?: string | null; isActive?: boolean; managerId?: number | null };
  if (body.isActive === false && id === req.user?.id) throw new AppError("You can't turn off your own account.", 409);
  if (body.managerId != null) {
    if (body.managerId === id) throw AppError.badRequest("A person can't be their own manager.");
    const [manager] = await req.db!.select({ id: users.id }).from(users).where(eq(users.id, body.managerId));
    if (!manager) throw AppError.badRequest("That manager isn't a user.");
  }
  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    const [clash] = await req.db!.select({ id: users.id }).from(users).where(sql`lower(${users.email}) = ${email}`);
    if (clash && clash.id !== id) throw AppError.badRequest("That email is already in use.");
    body.email = email;
  }
  let nextRoleName = before.roleName;
  if (body.roleId !== undefined && body.roleId !== before.roleId) {
    if (body.roleId == null) nextRoleName = null;
    else {
      const [nextRole] = await req.db!.select({ name: roles.name }).from(roles).where(eq(roles.id, body.roleId));
      if (!nextRole) throw AppError.badRequest("That role doesn't exist.");
      nextRoleName = nextRole.name;
    }
  }
  const leavingFullAccess = isFullAccessRole(before.roleName) && before.isActive && ((body.isActive === false) || (body.roleId !== undefined && !isFullAccessRole(nextRoleName)));
  if (leavingFullAccess && (await otherActiveFullAccess(req.db!, id)) < 1) {
    throw new AppError("This is the last Owner or Administrator. Give that access to someone else first.", 409);
  }
  const revokeSessions =
    (body.isActive === false && before.isActive) ||
    (body.roleId !== undefined && body.roleId !== before.roleId) ||
    (body.department !== undefined && body.department !== before.department) ||
    (body.email !== undefined && body.email !== before.email);

  const patch = {
    ...(body.name !== undefined ? { name: body.name } : {}),
    ...(body.email !== undefined ? { email: body.email } : {}),
    ...(body.roleId !== undefined ? { roleId: body.roleId } : {}),
    ...(body.department !== undefined ? { department: body.department } : {}),
    ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
    ...(body.managerId !== undefined ? { managerId: body.managerId } : {}),
    ...(revokeSessions ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}),
    updatedAt: new Date(),
  };
  const [updated] = await req.db!.update(users).set(patch).where(eq(users.id, id)).returning();
  if (!updated) throw AppError.notFound("User");

  // Previously the only mutating handler in the codebase with zero audit
  // trail — this is also the real endpoint behind both User Onboarding and
  // a Role Change's roleId path, so this one change closes both gaps at
  // once (see accuqual-workflow-architecture.md's audit-gap finding).
  await recordAuditTrail(req.db!, {
    entityType: "User",
    entityId: updated.id,
    action: "update",
    changes: { fieldsChanged: Object.keys(body).filter((key) => body[key as keyof typeof body] !== undefined), ...(revokeSessions ? { sessionsRevoked: true } : {}) },
    performedBy: req.user?.id,
  });
  if (revokeSessions) await revokeRefreshTokenRows(updated.id);

  const { passwordHash: _omit, ...safe } = updated;
  res.json(safe);
});

/**
 * A user's own theme override — scoped by req.user!.id alone (no admin
 * check, unlike GET/PATCH /users/:id, since this only ever reads/writes the
 * caller's own row).  */
export const getMyTheme = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select({ themePreferences: users.themePreferences }).from(users).where(eq(users.id, req.user!.id));
  res.json(row?.themePreferences ?? {});
});

export const updateMyTheme = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await req.db!.select({ themePreferences: users.themePreferences }).from(users).where(eq(users.id, req.user!.id));
  const body = req.body as Record<string, string>;
  // "" clears a field back to unset (follow company/default) rather than storing an empty string forever.
  const patch = Object.fromEntries(Object.entries(body).map(([k, v]) => [k, v === "" ? undefined : v]));
  const merged = { ...existing?.themePreferences, ...patch };
  const fieldsChanged = Object.keys(body);

  const [updated] = await req.db!.update(users).set({ themePreferences: merged, updatedAt: new Date() }).where(eq(users.id, req.user!.id)).returning();
  if (!updated) throw AppError.notFound("User");

  await recordAuditTrail(req.db!, {
    entityType: "User",
    entityId: req.user!.id,
    action: "update",
    changes: { fieldsChanged },
    performedBy: req.user?.id,
  });
  res.json(updated.themePreferences);
});

/** What's new: the version this user last opened the changelog panel at. null = never opened it (matches the pre-any-release default, so a brand-new account doesn't see a spurious badge before the app has any changelog entries at all to compare against). */
export const getMyChangelogSeen = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select({ lastSeenChangelogVersion: users.lastSeenChangelogVersion }).from(users).where(eq(users.id, req.user!.id));
  res.json({ lastSeenVersion: row?.lastSeenChangelogVersion ?? null });
});

/** Marks the changelog seen as of `version` — called once when the panel is opened, not per-scroll or per-item. */
export const updateMyChangelogSeen = asyncHandler(async (req: Request, res: Response) => {
  const { version } = req.body as { version: string };
  const [updated] = await req.db!.update(users).set({ lastSeenChangelogVersion: version, updatedAt: new Date() }).where(eq(users.id, req.user!.id)).returning({ lastSeenChangelogVersion: users.lastSeenChangelogVersion });
  if (!updated) throw AppError.notFound("User");
  res.json({ lastSeenVersion: updated.lastSeenChangelogVersion });
});

/** Saved list-view search filters — the whole per-page blob, same "return everything, let the caller pick the key it wants" shape getMyTheme uses. */
export const getMySavedViews = asyncHandler(async (req: Request, res: Response) => {
  const [row] = await req.db!.select({ savedViews: users.savedViews }).from(users).where(eq(users.id, req.user!.id));
  res.json(row?.savedViews ?? {});
});

/** Merge-patches one or more page keys into the saved-views blob — identical shape to updateMyTheme's per-field merge, just keyed by page id instead of a fixed theme field. Sending `{ "ncr-list": [] }` clears that page's saved views without touching any other page's. */
export const updateMySavedViews = asyncHandler(async (req: Request, res: Response) => {
  const [existing] = await req.db!.select({ savedViews: users.savedViews }).from(users).where(eq(users.id, req.user!.id));
  const patch = req.body as Record<string, { label: string; searchText: string }[]>;
  const merged = { ...existing?.savedViews, ...patch };
  const fieldsChanged = Object.keys(patch);

  const [updated] = await req.db!.update(users).set({ savedViews: merged, updatedAt: new Date() }).where(eq(users.id, req.user!.id)).returning();
  if (!updated) throw AppError.notFound("User");

  await recordAuditTrail(req.db!, {
    entityType: "User",
    entityId: req.user!.id,
    action: "update",
    changes: { fieldsChanged: fieldsChanged.map((page) => `savedViews.${page}`) },
    performedBy: req.user?.id,
  });
  res.json(updated.savedViews);
});

async function clearSignInRows(db: Db, userId: number) {
  await db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
  await db.delete(trustedDevices).where(eq(trustedDevices.userId, userId));
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
  await db.delete(userIdentities).where(eq(userIdentities.userId, userId));
  await db.delete(userPermissionRoles).where(eq(userPermissionRoles.userId, userId));
  await db.delete(userSites).where(eq(userSites.userId, userId));
}

function isForeignKeyError(err: unknown): boolean {
  const error = err as { code?: string; cause?: { code?: string } };
  return error.code === "23503" || error.cause?.code === "23503";
}

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [target] = await req
    .db!.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive, roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id));
  if (!target) throw AppError.notFound("User");

  const decision = decideUserRemoval({
    actorId: req.user?.id ?? 0,
    targetId: id,
    targetRoleName: target.roleName,
    otherActiveFullAccess: await otherActiveFullAccess(req.db!, id),
    history: await loadUserHistory(req.db!, id),
  });
  if (decision.outcome === "blocked") throw new AppError(decision.message, decision.status);

  if (decision.outcome === "deleted") {
    try {
      await req.db!.transaction(async (tx) => {
        await clearSignInRows(tx, id);
        await recordAuditTrail(tx, { entityType: "User", entityId: id, action: "delete", changes: { action: "hard_delete", email: target.email, name: target.name }, performedBy: req.user?.id });
        await tx.delete(users).where(eq(users.id, id));
      });
      res.status(200).json({ outcome: "deleted", message: decision.message });
      return;
    } catch (err) {
      if (!isForeignKeyError(err)) throw err;
    }
  }

  const [updated] = await req
    .db!.update(users)
    .set({ isActive: false, tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
    .where(eq(users.id, id))
    .returning();
  if (!updated) throw AppError.notFound("User");
  const message = decision.outcome === "deactivated" ? decision.message : "This person has records tied to them, so the account was turned off instead of erased. Their name stays on those records, and they can no longer sign in.";
  await recordAuditTrail(req.db!, { entityType: "User", entityId: updated.id, action: "status_change", changes: { action: "deactivate", sessionsRevoked: true, reason: message }, performedBy: req.user?.id });
  await revokeRefreshTokenRows(updated.id);
  res.status(200).json({ outcome: "deactivated", message });
});

/** Admin clears a sign-in lockout without waiting for it to expire (the user can also clear it by resetting their password). */
export const unlockUser = asyncHandler(async (req: Request, res: Response) => {
  const [updated] = await req
    .db!.update(users)
    .set({ lockedUntil: null, failedLoginCount: 0, firstFailedLoginAt: null })
    .where(and(eq(users.id, Number(req.params.id))))
    .returning({ id: users.id });
  if (!updated) throw AppError.notFound("User");
  await recordAuditTrail(req.db!, { entityType: "User", entityId: updated.id, action: "status_change", changes: { action: "account_unlocked" }, performedBy: req.user?.id });
  res.status(204).send();
});

/** An administrator replaces the password with one they hand out. The person must choose their own the next time they sign in, and every current session and trusted device ends now. */
export const setTemporaryPassword = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const { password } = req.body as { password: string };
  const [target] = await req.db!.select({ id: users.id, email: users.email, name: users.name }).from(users).where(eq(users.id, id));
  if (!target) throw AppError.notFound("User");
  await assertPasswordAcceptable(password, { email: target.email, name: target.name ?? undefined });
  const passwordHash = await bcrypt.hash(password, 10);
  const [updated] = await req
    .db!.update(users)
    .set({
      passwordHash,
      mustChangePassword: true,
      passwordChangedAt: new Date(),
      tokenVersion: sql`${users.tokenVersion} + 1`,
      failedLoginCount: 0,
      firstFailedLoginAt: null,
      lockedUntil: null,
      updatedAt: new Date(),
    })
    .where(eq(users.id, id))
    .returning({ id: users.id });
  if (!updated) throw AppError.notFound("User");
  await revokeRefreshTokenRows(updated.id);
  await revokeAllTrustedDevices(updated.id, "temporary_password_set", req.user?.id);
  await recordAuditTrail(req.db!, { entityType: "User", entityId: updated.id, action: "status_change", changes: { action: "temporary_password_set" }, performedBy: req.user?.id });
  res.status(204).send();
});

/** Lost phone and no recovery codes: an admin clears the user's second factor. Their sessions end, and they re-enroll at next sign-in if policy requires it. */
export const resetUserMfa = asyncHandler(async (req: Request, res: Response) => {
  const [target] = await req.db!.select({ id: users.id, mfaEnabled: users.mfaEnabled }).from(users).where(and(eq(users.id, Number(req.params.id))));
  if (!target) throw AppError.notFound("User");
  await clearMfa(target.id);
  await req.db!.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, target.id));
  await revokeRefreshTokenRows(target.id);
  await revokeAllTrustedDevices(target.id, "mfa_reset_by_admin", req.user?.id);
  await recordAuditTrail(req.db!, { entityType: "User", entityId: target.id, action: "status_change", changes: { action: "mfa_reset_by_admin", hadMfa: target.mfaEnabled }, performedBy: req.user?.id });
  res.status(204).send();
});
