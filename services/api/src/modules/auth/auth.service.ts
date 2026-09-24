import bcrypt from "bcryptjs";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { assertPasswordAcceptable } from "../../utils/passwordPolicy.js";
import { metrics } from "../monitoring/metrics.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { checkSecondFactor, clearMfa, confirmEnrollment, evaluateMfa, markMfaRequired, recoveryCodesRemaining, regenerateRecoveryCodes, signMfaToken, startEnrollment, verifyMfaToken } from "./mfa.service.js";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { ssoConnections } from "../../drizzle/schema/sso.js";
import { passwordResetTokens } from "../../drizzle/schema/passwordResetTokens.js";
import { refreshTokens } from "../../drizzle/schema/refreshTokens.js";
import { AppError } from "../../utils/appError.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken, REFRESH_TOKEN_TTL_MS, REMEMBER_ME_TTL_MS } from "../../utils/jwt.js";
import { sendEmail } from "../notifications/notification.service.js";
import { renderTemplate } from "../notifications/templates.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

// Registration/login run before a tenant transaction exists (the tenant isn't
// known yet, or is being resolved), so — unlike every other module — this
// service intentionally uses the plain, unscoped `db` singleton.

async function userWithRole(userId: number) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      tokenVersion: users.tokenVersion,
      isActive: users.isActive,
      tenantId: users.tenantId,
      roleId: users.roleId,
      roleName: roles.name,
      department: users.department,
      supplierId: users.supplierId,
      mfaEnabled: users.mfaEnabled,
      mfaRequiredSince: users.mfaRequiredSince,
      tenantMfaPolicy: tenants.mfaPolicy,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, userId));
  return row;
}

/**
 * Security-audit finding (medium): every issued refresh token now gets a
 * unique jti, recorded in refresh_tokens (unused/unrevoked) so refresh()
 * can later tell a normal single redemption apart from the same token
 * being replayed after it was already rotated — see refreshTokens.ts's
 * own comment.
 */
async function issueTokens(user: {
  id: number;
  tenantId: number | null;
  roleId: number | null;
  roleName: string | null;
  department: string | null;
  supplierId?: number | null;
  tokenVersion: number;
}, remember = false) {
  const accessToken = signAccessToken({
    sub: String(user.id),
    tenantId: user.tenantId,
    roleId: user.roleId,
    roleName: user.roleName,
    department: user.department,
    supplierId: user.supplierId ?? null,
    tv: user.tokenVersion,
  });
  const jti = randomUUID();
  const refreshToken = signRefreshToken({ sub: String(user.id), tokenVersion: user.tokenVersion, jti, ...(remember ? { rm: true } : {}) });
  await db.insert(refreshTokens).values({ userId: user.id, jti, expiresAt: new Date(Date.now() + (remember ? REMEMBER_ME_TTL_MS : REFRESH_TOKEN_TTL_MS)) });
  // refreshJti never reaches a response body — auth.controller.ts's
  // withoutRefreshToken strips it alongside refreshToken itself; it's only
  // for refresh()'s own internal replacedByJti bookkeeping below.
  return { accessToken, refreshToken, refreshJti: jti, remember };
}

export async function register(input: { email: string; password: string; name?: string; tenantCode: string }) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.code, input.tenantCode));
  if (!tenant || tenant.status !== "active" || tenant.isDeleted) {
    throw AppError.badRequest("Unknown or inactive tenant code");
  }

  const existing = await db.select().from(users).where(sql`lower(${users.email}) = lower(${input.email})`);
  if (existing.length > 0) throw AppError.badRequest("Email already registered");

  await assertPasswordAcceptable(input.password, { email: input.email, name: input.name });
  const passwordHash = await bcrypt.hash(input.password, 10);
  const [created] = await db
    .insert(users)
    .values({ email: input.email, passwordHash, name: input.name, tenantId: tenant.id, passwordChangedAt: new Date() })
    .returning();
  if (!created) throw new AppError("Failed to create user", 500);

  const full = await userWithRole(created.id);
  if (!full) throw new AppError("Failed to create user", 500);
  const tokens = await issueTokens(full);
  return { user: sanitize(full), tenant: { id: tenant.id, name: tenant.name, code: tenant.code, branding: tenant.branding }, ...tokens };
}

export async function login(input: { email: string; password: string; rememberMe?: boolean }) {
  const [row] = await db
    .select()
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(sql`lower(${users.email}) = lower(${input.email})`);
  if (!row) throw AppError.unauthorized("Invalid credentials");

  const user = row.users;
  const roleName = row.roles?.name ?? null;
  if (!user.isActive) throw AppError.forbidden("Account is deactivated");
  if (user.tenantId && (!row.tenants || row.tenants.status !== "active" || row.tenants.isDeleted)) {
    throw AppError.forbidden("Tenant is inactive");
  }

  // A locked account is refused BEFORE the password is even compared, so
  // guessing during the lock learns nothing and cannot extend it.
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60_000));
    throw new AppError(`Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`, 429);
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) {
    await recordFailedLogin(user);
    throw AppError.unauthorized("Invalid credentials");
  }

  // When the tenant has made single sign-on mandatory, passwords no longer work — except for admins, who keep a break-glass way in if the identity provider is down or misconfigured.
  if (user.tenantId && roleName !== "admin" && roleName !== "platform_admin") {
    const [sso] = await db.select({ enabled: ssoConnections.enabled, enforce: ssoConnections.enforceSso }).from(ssoConnections).where(eq(ssoConnections.tenantId, user.tenantId));
    if (sso?.enabled && sso.enforce) throw AppError.forbidden("Your organization requires single sign-on. Use the Single sign-on option on the sign-in page.");
  }

  // The password alone is not enough when the account has a second factor, or
  // when the tenant's policy says it must have one. Nothing is issued (no
  // tokens, no cookie) and the failure counters stay untouched until the
  // second step succeeds.
  const mfa = evaluateMfa(user, roleName, row.tenants?.mfaPolicy);
  if (user.mfaEnabled) return { mfaRequired: true as const, mfaToken: signMfaToken(user.id, "verify", user.tokenVersion) };
  if (mfa.state === "blocked") return { mfaEnrollmentRequired: true as const, mfaToken: signMfaToken(user.id, "enroll", user.tokenVersion) };
  if (mfa.required && !user.mfaRequiredSince) await markMfaRequired(user.id);

  return completeLogin(user, roleName, row.tenants, mfa.state === "grace" ? mfa.graceEndsAt : null, input.rememberMe === true);
}

type LoginUserRow = typeof users.$inferSelect;
type LoginTenantRow = typeof tenants.$inferSelect | null;

/** Stamps the successful sign-in, clears the failed-attempt counters (and an expired lock), and issues the session. */
async function completeLogin(user: LoginUserRow, roleName: string | null, tenant: LoginTenantRow, mfaGraceEndsAt: Date | null = null, remember = false) {
  // Phase 7 — Supplier Portal health indicators ("last supplier login")
  // read this; best-effort, never blocks a successful login on its own
  // failure.
  await db.update(users).set({ lastLoginAt: new Date(), failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, user.id)).catch(() => undefined);

  const tokens = await issueTokens({ id: user.id, tenantId: user.tenantId, roleId: user.roleId, roleName, department: user.department, supplierId: user.supplierId, tokenVersion: user.tokenVersion }, remember);
  return {
    user: sanitize({ ...user, roleName }),
    tenant: tenant ? { id: tenant.id, name: tenant.name, code: tenant.code, branding: tenant.branding } : null,
    ...(mfaGraceEndsAt ? { mfaGraceEndsAt: mfaGraceEndsAt.toISOString() } : {}),
    ...tokens,
  };
}

async function loginContext(userId: number) {
  const [row] = await db
    .select()
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.id, userId));
  if (!row) throw AppError.unauthorized("Your sign-in expired. Please start again.");
  if (row.users.lockedUntil && row.users.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((row.users.lockedUntil.getTime() - Date.now()) / 60_000));
    throw new AppError(`Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`, 429);
  }
  return { user: row.users, roleName: row.roles?.name ?? null, tenant: row.tenants };
}

/** Second step of a sign-in: the authenticator (or recovery) code. Wrong codes count toward the same lockout as wrong passwords. */
export async function verifyMfaLogin(mfaToken: string, code: string, rememberMe = false) {
  const userId = await verifyMfaToken(mfaToken, "verify");
  const ctx = await loginContext(userId);
  const kind = await checkSecondFactor(userId, code);
  if (!kind) {
    await recordFailedLogin(ctx.user);
    throw AppError.unauthorized("That code didn't work. Try the newest code from your authenticator app, or a recovery code.");
  }
  if (kind === "recovery" && ctx.user.tenantId) {
    await recordAuditTrail(db, { tenantId: ctx.user.tenantId, entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_recovery_code_used" }, performedBy: userId }).catch((err) => logger.error("Failed to audit a recovery-code sign-in", { userId, err }));
  }
  return completeLogin(ctx.user, ctx.roleName, ctx.tenant, null, rememberMe);
}

/** Enrollment that is forced at sign-in (tenant policy requires MFA and the grace period is over): the challenge token stands in for a session. */
export async function startEnrollmentWithToken(mfaToken: string) {
  const userId = await verifyMfaToken(mfaToken, "enroll");
  const ctx = await loginContext(userId);
  return startEnrollment(userId, ctx.user.email);
}

export async function confirmEnrollmentWithToken(mfaToken: string, code: string, rememberMe = false) {
  const userId = await verifyMfaToken(mfaToken, "enroll");
  const ctx = await loginContext(userId);
  let recoveryCodes: string[];
  try {
    recoveryCodes = await confirmEnrollment(userId, code);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 400 && /didn't match/.test(err.message)) await recordFailedLogin(ctx.user);
    throw err;
  }
  if (ctx.user.tenantId) {
    await recordAuditTrail(db, { tenantId: ctx.user.tenantId, entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_enabled" }, performedBy: userId }).catch((err) => logger.error("Failed to audit MFA enrollment", { userId, err }));
  }
  const [fresh] = await db.select().from(users).where(eq(users.id, userId));
  return { ...(await completeLogin(fresh ?? ctx.user, ctx.roleName, ctx.tenant, null, rememberMe)), recoveryCodes };
}

/**
 * Counts one wrong password. LOGIN_MAX_FAILURES of them inside
 * LOGIN_FAILURE_WINDOW_MINUTES lock the account for LOGIN_LOCKOUT_MINUTES,
 * leaving an audit entry and emailing the owner. The increment itself is one
 * atomic SQL statement, so parallel guesses can't undercount; only the request
 * that actually flips the account to locked writes the audit entry and email.
 */
async function recordFailedLogin(user: { id: number; email: string; tenantId: number | null; firstFailedLoginAt: Date | null }): Promise<void> {
  metrics.loginFailures.add(); // feeds the "sign-in attacks" alert
  const windowMs = env.LOGIN_FAILURE_WINDOW_MINUTES * 60_000;
  const windowExpired = !user.firstFailedLoginAt || user.firstFailedLoginAt.getTime() < Date.now() - windowMs;
  const [after] = await db
    .update(users)
    .set(windowExpired ? { failedLoginCount: 1, firstFailedLoginAt: new Date() } : { failedLoginCount: sql`${users.failedLoginCount} + 1` })
    .where(eq(users.id, user.id))
    .returning({ count: users.failedLoginCount });
  if (!after || after.count < env.LOGIN_MAX_FAILURES) return;

  const now = new Date();
  const lockedUntil = new Date(now.getTime() + env.LOGIN_LOCKOUT_MINUTES * 60_000);
  const [locked] = await db
    .update(users)
    .set({ lockedUntil, failedLoginCount: 0, firstFailedLoginAt: null })
    .where(and(eq(users.id, user.id), or(isNull(users.lockedUntil), lt(users.lockedUntil, now))))
    .returning({ id: users.id });
  if (!locked) return; // a parallel request already locked it
  metrics.lockouts.add();

  if (user.tenantId) {
    await recordAuditTrail(db, {
      tenantId: user.tenantId,
      entityType: "User",
      entityId: user.id,
      action: "status_change",
      changes: { action: "account_locked", reason: "too_many_failed_logins", failedAttempts: after.count, lockedUntil: lockedUntil.toISOString() },
    }).catch((err) => logger.error("Failed to audit an account lockout", { userId: user.id, err }));
  }
  logger.warn(`Account ${user.id} locked for ${env.LOGIN_LOCKOUT_MINUTES} minutes after ${after.count} failed sign-ins.`);

  const notice = renderTemplate("account_locked", {
    attempts: String(after.count),
    lockoutMinutes: String(env.LOGIN_LOCKOUT_MINUTES),
    resetUrl: `${env.FRONTEND_URL}/forgot-password`,
  });
  await sendEmail({ to: user.email, subject: notice.subject, body: notice.body }).catch((err) => logger.error("Failed to send the account-locked email", { userId: user.id, err }));
}

export async function refresh(refreshToken: string) {
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    throw AppError.unauthorized("Invalid or expired refresh token");
  }

  const full = await userWithRole(Number(payload.sub));
  if (!full || full.tokenVersion !== payload.tokenVersion) {
    throw AppError.unauthorized("Refresh token has been revoked");
  }
  // A deactivated account must not be able to mint new access tokens.
  if (!full.isActive) {
    await revokeRefreshTokenRows(full.id);
    throw AppError.unauthorized("Account is deactivated");
  }
  // Tenant policy may have started requiring MFA since this session began; once the grace period is over the user must go back through sign-in, which walks them through enrollment.
  if (evaluateMfa(full, full.roleName, full.tenantMfaPolicy).state === "blocked") {
    throw AppError.unauthorized("Multi-factor authentication setup is required. Please sign in again.");
  }

  // Security-audit finding (medium): reuse detection. `jti` is only absent
  // on a token minted before this feature existed (graceful degrade — an
  // old in-flight session isn't force-logged-out by this deploy). For every
  // token that has one, a second redemption after it was already marked
  // used means this exact token was replayed — either a client race (rare,
  // and treated the same as theft on purpose: better a false-positive
  // logout than silently trusting a replayed credential) or a stolen
  // token being used after the legitimate client already rotated past it.
  // Either way the correct response is the same one logout()/resetPassword()
  // already use: revoke the whole account's session via tokenVersion, not
  // just this one token.
  if (payload.jti) {
    const [tokenRow] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, payload.jti));
    if (!tokenRow || tokenRow.revokedAt) {
      throw AppError.unauthorized("Refresh token has been revoked");
    }
    // Idle timeout: an active browser renews its access token every
    // JWT_ACCESS_TTL, so a refresh token this old means nobody used the
    // session for that long. Ends the session; the user signs in again.
    const idleLimitMs = payload.rm ? REMEMBER_ME_TTL_MS : env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
    if (tokenRow.createdAt && Date.now() - tokenRow.createdAt.getTime() > idleLimitMs) {
      await revokeRefreshTokenRows(full.id);
      throw AppError.unauthorized("Your session ended after a period of inactivity. Please sign in again.");
    }
    if (tokenRow.usedAt) {
      logger.warn(`Refresh token reuse detected for user ${full.id} (jti ${payload.jti}) — revoking the account's session.`);
      await revokeAllRefreshTokens(full.id);
      await db.update(users).set({ tokenVersion: full.tokenVersion + 1 }).where(eq(users.id, full.id));
      throw AppError.unauthorized("Refresh token has already been used — session revoked for safety");
    }
    await db.update(refreshTokens).set({ usedAt: new Date() }).where(eq(refreshTokens.id, tokenRow.id));
  }

  const tokens = await issueTokens(full, payload.rm === true);
  if (payload.jti) {
    await db.update(refreshTokens).set({ replacedByJti: tokens.refreshJti }).where(eq(refreshTokens.jti, payload.jti));
  }
  const tenant = full.tenantId ? await tenantById(full.tenantId) : null;
  return { user: sanitize(full), tenant, ...tokens };
}

/** Marks every not-yet-revoked refresh token row for this user as revoked — logout()/resetPassword() call this alongside their own tokenVersion bump for real, itemizable revocation instead of relying on tokenVersion alone. */
export const revokeRefreshTokenRows = revokeAllRefreshTokens;

async function revokeAllRefreshTokens(userId: number): Promise<void> {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
}

/**
 * `refresh()`'s own tenant lookup — mirrors `login()`'s `tenant` shape
 * exactly. Without this, a browser whose persisted `user`/`tenant` (see
 * authStore.ts's partialize) is missing — a genuinely new device/browser,
 * or storage cleared without logging out first — could silently refresh
 * into an "authenticated but contextless" session: a real accessToken with
 * no tenantId anywhere in the client, so every tenant-scoped action (e.g.
 * useWindowStore's openWindow) fails with "No tenant context" instead of
 * the client ever having a chance to rebuild it. `useAuthBootstrap` only
 * calls `refreshAccessToken()` (client.ts), which only ever consumed the
 * response's `accessToken` — updated alongside this to also apply `user`/
 * `tenant` from the same response, so a bootstrap-refresh is self-
 * sufficient on its own, the way an httpOnly-cookie session is supposed to be.
 */
async function tenantById(tenantId: number) {
  const [row] = await db
    .select({ id: tenants.id, name: tenants.name, code: tenants.code, branding: tenants.branding })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  return row ?? null;
}

/**
 * Bumps the user's tokenVersion, invalidating every outstanding refresh
 * token's signature check, and also marks every refresh_tokens row
 * revoked — real, itemizable revocation (security-audit finding) on top
 * of the coarser tokenVersion mechanism, not a second copy of the same
 * fact: a revoked row is what makes reuse detection (refresh()) report
 * "revoked" instead of quietly accepting a token whose only defense was
 * an already-bumped tokenVersion the payload happens to still match
 * (impossible today since the JWT itself is re-verified too, but the
 * explicit row is what a future audit of "was this token really dead"
 * checks against directly, not an inference from tokenVersion arithmetic).
 */
export async function logout(userId: number) {
  await db
    .update(users)
    .set({ tokenVersion: (await currentTokenVersion(userId)) + 1 })
    .where(eq(users.id, userId));
  await revokeAllRefreshTokens(userId);
}

async function currentTokenVersion(userId: number): Promise<number> {
  const [row] = await db.select({ tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId));
  return row?.tokenVersion ?? 0;
}

const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

function hashResetToken(rawToken: string): string {
  // sha256, not bcrypt — this is a high-entropy random token (32 raw bytes),
  // not a human-chosen password, so there's no brute-force-guessing risk to
  // defend against with a slow hash; a fast, deterministic hash is exactly
  // what a lookup-by-hash needs.
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Inspection Report ONB-02/R05: there was no password-recovery path at all.
 * Deliberately silent about whether the email exists — the response (and
 * timing) must look identical either way, or this endpoint becomes a way to
 * enumerate registered emails. Real delivery goes through the same
 * sendEmail() every other notification does — logged-only until a real SMTP
 * transport is configured (see notification.service.ts), never a fabricated
 * "email sent" claim.
 */
export async function forgotPassword(email: string): Promise<void> {
  const [user] = await db.select().from(users).where(sql`lower(${users.email}) = lower(${email})`);
  if (!user || !user.isActive) return;

  const rawToken = randomBytes(32).toString("hex");
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashResetToken(rawToken),
    expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
  });

  const resetUrl = `${env.FRONTEND_URL}/reset-password?token=${rawToken}`;
  const resetEmail = renderTemplate("password_reset", { resetUrl, expiresInMinutes: String(RESET_TOKEN_TTL_MS / 60_000) });
  await sendEmail({ to: user.email, subject: resetEmail.subject, body: resetEmail.body });
}

/** Bumps tokenVersion and revokes every refresh_tokens row too — a password reset revokes every outstanding refresh token, the same way logout() does. */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const [tokenRow] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hashResetToken(rawToken)));

  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt.getTime() < Date.now()) {
    throw AppError.badRequest("This reset link is invalid or has expired.");
  }

  const [owner] = await db.select({ email: users.email, name: users.name, tenantId: users.tenantId, lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, tokenRow.userId));
  await assertPasswordAcceptable(newPassword, { email: owner?.email, name: owner?.name ?? undefined });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const nextTokenVersion = (await currentTokenVersion(tokenRow.userId)) + 1;
  // Proving control of the mailbox also clears any lockout.
  await db
    .update(users)
    .set({ passwordHash, tokenVersion: nextTokenVersion, passwordChangedAt: new Date(), failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null })
    .where(eq(users.id, tokenRow.userId));
  if (owner?.tenantId) {
    await recordAuditTrail(db, {
      tenantId: owner.tenantId,
      entityType: "User",
      entityId: tokenRow.userId,
      action: "status_change",
      changes: { action: "password_reset", unlockedAccount: !!owner.lockedUntil && owner.lockedUntil.getTime() > Date.now() },
      performedBy: tokenRow.userId,
    }).catch((err) => logger.error("Failed to audit a password reset", { userId: tokenRow.userId, err }));
  }
  await revokeAllRefreshTokens(tokenRow.userId);
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, tokenRow.id));
}

export async function me(userId: number) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  return sanitize(full);
}

/** Everything a session response may show about a user — never the password hash, the MFA secret, or lockout bookkeeping. */
function sanitize<T extends { passwordHash?: string }>(user: T) {
  const {
    passwordHash: _passwordHash,
    mfaSecretEncrypted: _mfaSecret,
    mfaLastUsedStep: _mfaStep,
    failedLoginCount: _failedCount,
    firstFailedLoginAt: _firstFailed,
    lockedUntil: _lockedUntil,
    tenantMfaPolicy: _policy,
    ...rest
  } = user as T & Record<string, unknown>;
  return rest;
}

// ---- Signed-in MFA management (My account) --------------------------------------------------------------------------------------------------

export async function mfaStatus(userId: number) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  const mfa = evaluateMfa(full, full.roleName, full.tenantMfaPolicy);
  return {
    enabled: mfa.enabled,
    required: mfa.required,
    state: mfa.state,
    graceEndsAt: mfa.graceEndsAt ? mfa.graceEndsAt.toISOString() : null,
    policy: full.tenantMfaPolicy ?? null,
    recoveryCodesRemaining: mfa.enabled ? await recoveryCodesRemaining(userId) : 0,
  };
}

export async function startMfaSetup(userId: number) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  return startEnrollment(userId, full.email);
}

export async function enableMfa(userId: number, code: string) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  const recoveryCodes = await confirmEnrollment(userId, code);
  if (full.tenantId) {
    await recordAuditTrail(db, { tenantId: full.tenantId, entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_enabled" }, performedBy: userId }).catch((err) => logger.error("Failed to audit MFA enrollment", { userId, err }));
  }
  return { recoveryCodes };
}

/** Re-proves who is at the keyboard (password AND a current code) before a security-sensitive change. Wrong answers count toward the lockout. */
async function reverify(userId: number, password: string, code: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw AppError.notFound("User");
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new AppError("Too many failed attempts. Try again later.", 429);
  const passwordOk = await bcrypt.compare(password, user.passwordHash);
  const codeOk = passwordOk ? await checkSecondFactor(userId, code) : null;
  if (!passwordOk || !codeOk) {
    await recordFailedLogin(user);
    throw AppError.unauthorized("Password or code was incorrect.");
  }
  return user;
}

export async function disableMfa(userId: number, password: string, code: string) {
  const user = await reverify(userId, password, code);
  const full = await userWithRole(userId);
  if (full && evaluateMfa({ mfaEnabled: false, mfaRequiredSince: full.mfaRequiredSince }, full.roleName, full.tenantMfaPolicy).required) {
    throw AppError.forbidden("Your organization requires multi-factor authentication, so it can't be turned off.");
  }
  await clearMfa(userId);
  if (user.tenantId) {
    await recordAuditTrail(db, { tenantId: user.tenantId, entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_disabled" }, performedBy: userId }).catch((err) => logger.error("Failed to audit MFA being turned off", { userId, err }));
  }
}

export async function newRecoveryCodes(userId: number, password: string, code: string) {
  const user = await reverify(userId, password, code);
  const recoveryCodes = await regenerateRecoveryCodes(userId);
  if (user.tenantId) {
    await recordAuditTrail(db, { tenantId: user.tenantId, entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_recovery_codes_regenerated" }, performedBy: userId }).catch((err) => logger.error("Failed to audit recovery-code regeneration", { userId, err }));
  }
  return { recoveryCodes };
}

/** Finishes a sign-in the identity provider already vouched for: the provider did the authenticating (including any MFA it enforces), so the local password/lockout/MFA steps do not apply. */
export async function startSessionForSsoUser(userId: number) {
  const [row] = await db.select().from(users).leftJoin(roles, eq(users.roleId, roles.id)).leftJoin(tenants, eq(users.tenantId, tenants.id)).where(eq(users.id, userId));
  if (!row || !row.users.isActive) throw AppError.forbidden("Account is deactivated");
  if (row.users.tenantId && (!row.tenants || row.tenants.status !== "active" || row.tenants.isDeleted)) throw AppError.forbidden("Tenant is inactive");
  return completeLogin(row.users, row.roles?.name ?? null, row.tenants);
}

/**
 * Re-confirms who is at the keyboard before something sensitive (a full data export): the current password, and a
 * two-step code when the account uses one. Wrong answers count toward the same lockout as wrong sign-ins.
 */
export async function confirmIdentity(userId: number, password: string, code?: string): Promise<void> {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user) throw AppError.notFound("User");
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw new AppError("Too many failed attempts. Try again later.", 429);
  if (!(await bcrypt.compare(password, user.passwordHash))) {
    await recordFailedLogin(user);
    throw AppError.unauthorized("That password isn't correct. (If you normally sign in with single sign-on, use “Forgot password” once to set one.)");
  }
  if (user.mfaEnabled && !(code && (await checkSecondFactor(userId, code)))) {
    await recordFailedLogin(user);
    throw AppError.unauthorized("Enter a current code from your authenticator app.");
  }
}
