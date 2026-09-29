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
import { loadOpenWork, reassignOpenWork, type OpenWorkGroup } from "./userOpenWork.js";
import { deleteUserSchema } from "./users.validation.js";
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
  if (isFullAccessRole(req.user?.roleName)) {
    res.json(rows);
    return;
  }
  res.json(
    rows.map((person) => ({
      id: person.id,
      email: person.email,
      name: person.name,
      roleId: person.roleId,
      department: person.department,
      managerId: person.managerId,
      isActive: person.isActive,
      createdAt: person.createdAt,
    })),
  );
});

export const getUser = asyncHandler(async (req: Request, res: Response) => {
  if (req.user?.roleName === "supplier") throw AppError.forbidden("Supplier logins can't open staff records.");
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
  if (!isFullAccessRole(req.user?.roleName)) {
    res.json({ id: row.id, name: row.name, email: row.email });
    return;
  }
  res.json(row);
});

export const createUser = asyncHandler(async (req: Request, res: Response) => {
  const { email, password, name, roleId, department, managerId } = req.body as {
    email: string;
    password: string;
    name?: string;
    roleId?: number;
    department?: string | null;
    managerId?: number | null;
  };
  if (managerId != null) {
    const [manager] = await req.db!.select({ id: users.id }).from(users).where(eq(users.id, managerId));
    if (!manager) throw AppError.badRequest("That manager isn't a user.");
  }
  // Said together so one submit explains every problem. A duplicate used to hit the unique-email rule and come back as a server error.
  const problems: string[] = [];
  if (!name?.trim()) problems.push("Enter a name.");
  if (roleId == null) problems.push("Choose a role.");
  else {
    const [role] = await req.db!.select({ id: roles.id }).from(roles).where(eq(roles.id, roleId));
    if (!role) problems.push("That role doesn't exist.");
  }
  const [existing] = await req.db!.select({ id: users.id }).from(users).where(sql`lower(btrim(${users.email})) = ${email}`);
  if (existing) problems.push("That email is already in use.");
  if (problems.length > 0) throw AppError.badRequest(problems.join(" "));
  await assertPasswordAcceptable(password, { email, name });
  const passwordHash = await bcrypt.hash(password, 10);
  try {
    const [created] = await req.db!.insert(users).values({ email, passwordHash, name, roleId, department, managerId: managerId ?? null, passwordChangedAt: new Date(), mustChangePassword: true }).returning();
    if (!created) throw new AppError("Failed to create user", 500);
    const { passwordHash: _omit, ...safe } = created;
    res.status(201).json(safe);
  } catch (err) {
    const pg = postgresError(err);
    if (pg.code === "23505") throw AppError.badRequest("That email is already in use.");
    if (pg.code === "23503" && pg.constraint?.includes("role")) throw AppError.badRequest("That role doesn't exist.");
    if (pg.code === "23503" && pg.constraint?.includes("manager")) throw AppError.badRequest("That manager isn't a user.");
    throw err;
  }
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

function postgresError(err: unknown): { code?: string; constraint?: string } {
  const error = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return { code: error.code ?? error.cause?.code, constraint: error.constraint ?? error.cause?.constraint };
}

function isForeignKeyError(err: unknown): boolean {
  return postgresError(err).code === "23503";
}

function removalAudit(moved: OpenWorkGroup[], replacement: { id: number; name: string | null; email: string } | null) {
  if (!replacement || moved.length === 0) return {};
  return {
    reassignedTo: replacement.id,
    reassignedToName: replacement.name?.trim() || replacement.email,
    openWork: moved.map((item) => ({ key: item.key, label: item.label, count: item.count })),
  };
}

/** Open work that must be handed to someone else before this account can be removed. */
export const getUserOpenWork = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const [target] = await req.db!.select({ id: users.id }).from(users).where(eq(users.id, id));
  if (!target) throw AppError.notFound("User");
  res.json({ openWork: await loadOpenWork(req.db!, id) });
});

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const parsed = deleteUserSchema.safeParse(req.body ?? {});
  if (!parsed.success) throw AppError.badRequest("Choose a person to take their open work.");

  const [target] = await req
    .db!.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive, roleName: roles.name })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, id));
  if (!target) throw AppError.notFound("User");

  const openWork = await loadOpenWork(req.db!, id);
  let replacement: { id: number; name: string | null; email: string } | null = null;
  if (openWork.length > 0 && parsed.data.replacementUserId != null) {
    const [row] = await req.db!.select({ id: users.id, name: users.name, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, parsed.data.replacementUserId));
    if (!row || !row.isActive || row.id === id) throw AppError.badRequest("Choose an active person, other than this one, to take their open work.");
    replacement = row;
  }

  const decision = decideUserRemoval({
    actorId: req.user?.id ?? 0,
    targetId: id,
    targetRoleName: target.roleName,
    otherActiveFullAccess: await otherActiveFullAccess(req.db!, id),
    history: await loadUserHistory(req.db!, id),
    openWork,
    hasReplacement: replacement != null,
  });
  if (decision.outcome === "blocked") {
    throw new AppError(decision.message, decision.status, decision.requiresReplacement ? { requiresReplacement: true, openWork } : undefined);
  }

  const handoff = replacement ? ` Open work was moved to ${replacement.name?.trim() || replacement.email}.` : "";
  const removalReason = parsed.data.reason && parsed.data.reason.length > 0 ? parsed.data.reason : undefined;
  const fromName = target.name?.trim() || target.email;
  const note = replacement ? { fromName, toName: replacement.name?.trim() || replacement.email, performedBy: req.user?.id } : undefined;

  if (decision.outcome === "deleted") {
    try {
      await req.db!.transaction(async (tx) => {
        const moved = replacement ? await reassignOpenWork(tx, id, replacement.id, note) : [];
        await clearSignInRows(tx, id);
        await recordAuditTrail(tx, { entityType: "User", entityId: id, action: "delete", changes: { action: "hard_delete", email: target.email, name: target.name, ...(removalReason ? { removalReason } : {}), ...removalAudit(moved, replacement) }, performedBy: req.user?.id });
        await tx.delete(users).where(eq(users.id, id));
      });
      res.status(200).json({ outcome: "deleted", message: `${decision.message}${handoff}` });
      return;
    } catch (err) {
      if (!isForeignKeyError(err)) throw err;
    }
  }

  let moved: OpenWorkGroup[] = [];
  const [updated] = await req.db!.transaction(async (tx) => {
    moved = replacement ? await reassignOpenWork(tx, id, replacement.id, note) : [];
    const [row] = await tx
      .update(users)
      .set({ isActive: false, tokenVersion: sql`${users.tokenVersion} + 1`, updatedAt: new Date() })
      .where(eq(users.id, id))
      .returning();
    return [row];
  });
  if (!updated) throw AppError.notFound("User");
  const message = `${decision.outcome === "deactivated" ? decision.message : "This person has records tied to them, so the account was turned off instead of erased. Their name stays on those records, and they can no longer sign in."}${handoff}`;
  await recordAuditTrail(req.db!, { entityType: "User", entityId: updated.id, action: "status_change", changes: { action: "deactivate", sessionsRevoked: true, reason: message, ...(removalReason ? { removalReason } : {}), ...removalAudit(moved, replacement) }, performedBy: req.user?.id });
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
