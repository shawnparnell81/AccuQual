import type { Request, Response } from "express";
import bcrypt from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { users } from "../../drizzle/schema/users.js";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { revokeRefreshTokenRows } from "../auth/auth.service.js";
import { clearMfa } from "../auth/mfa.service.js";
import { assertPasswordAcceptable } from "../../utils/passwordPolicy.js";

export const listUsers = asyncHandler(async (req: Request, res: Response) => {
  const rows = await req
    .db!.select({
      id: users.id,
      email: users.email,
      name: users.name,
      roleId: users.roleId,
      department: users.department,
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
  const [created] = await req.db!.insert(users).values({ email, passwordHash, name, roleId, department, passwordChangedAt: new Date() }).returning();
  if (!created) throw new AppError("Failed to create user", 500);
  const { passwordHash: _omit, ...safe } = created;
  res.status(201).json(safe);
});

export const updateUser = asyncHandler(async (req: Request, res: Response) => {
  const [before] = await req.db!.select({ roleId: users.roleId, department: users.department, isActive: users.isActive }).from(users).where(and(eq(users.id, Number(req.params.id))));
  if (!before) throw AppError.notFound("User");
  // Disabling a user, or changing what they may do, ends their current sessions: bumping token_version makes requireAuth refuse their access token on the very next request and blocks every refresh token. They sign in again and get the new permissions.
  const body = req.body as { roleId?: number | null; department?: string | null; isActive?: boolean };
  const revokeSessions =
    (body.isActive === false && before.isActive) ||
    (body.roleId !== undefined && body.roleId !== before.roleId) ||
    (body.department !== undefined && body.department !== before.department);

  const [updated] = await req
    .db!.update(users)
    .set({ ...req.body, ...(revokeSessions ? { tokenVersion: sql`${users.tokenVersion} + 1` } : {}), updatedAt: new Date() })
    .where(and(eq(users.id, Number(req.params.id))))
    .returning();
  if (!updated) throw AppError.notFound("User");

  // Previously the only mutating handler in the codebase with zero audit
  // trail — this is also the real endpoint behind both User Onboarding and
  // a Role Change's roleId path, so this one change closes both gaps at
  // once (see accuqual-workflow-architecture.md's audit-gap finding).
  await recordAuditTrail(req.db!, {
    entityType: "User",
    entityId: updated.id,
    action: "update",
    changes: { fieldsChanged: Object.keys(req.body), ...(revokeSessions ? { sessionsRevoked: true } : {}) },
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

export const deleteUser = asyncHandler(async (req: Request, res: Response) => {
  const [updated] = await req
    .db!.update(users)
    .set({ isActive: false, tokenVersion: sql`${users.tokenVersion} + 1` })
    .where(and(eq(users.id, Number(req.params.id))))
    .returning();
  if (!updated) throw AppError.notFound("User");
  // Deactivation is an access-removal event an auditor asks about — it used to leave no entry at all.
  await recordAuditTrail(req.db!, { entityType: "User", entityId: updated.id, action: "status_change", changes: { action: "deactivate", sessionsRevoked: true }, performedBy: req.user?.id });
  await revokeRefreshTokenRows(updated.id);
  res.status(204).send();
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

/** Lost phone and no recovery codes: an admin clears the user's second factor. Their sessions end, and they re-enroll at next sign-in if policy requires it. */
export const resetUserMfa = asyncHandler(async (req: Request, res: Response) => {
  const [target] = await req.db!.select({ id: users.id, mfaEnabled: users.mfaEnabled }).from(users).where(and(eq(users.id, Number(req.params.id))));
  if (!target) throw AppError.notFound("User");
  await clearMfa(target.id);
  await req.db!.update(users).set({ tokenVersion: sql`${users.tokenVersion} + 1` }).where(eq(users.id, target.id));
  await revokeRefreshTokenRows(target.id);
  await recordAuditTrail(req.db!, { entityType: "User", entityId: target.id, action: "status_change", changes: { action: "mfa_reset_by_admin", hadMfa: target.mfaEnabled }, performedBy: req.user?.id });
  res.status(204).send();
});
