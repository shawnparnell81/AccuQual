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
import { company } from "../../drizzle/schema/company.js";
import { ssoConnections } from "../../drizzle/schema/sso.js";
import { passwordResetTokens } from "../../drizzle/schema/passwordResetTokens.js";
import { refreshTokens } from "../../drizzle/schema/refreshTokens.js";
import { AppError } from "../../utils/appError.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { sessionLengthHoursFromProfile, sessionLengthMs } from "./sessionLength.js";
import { issueTrustedDevice, revokeAllTrustedDevices, useTrustedDevice } from "./trustedDevice.service.js";

/**
 * Two renewals that leave the browser at the same moment both present the
 * token that was just rotated. That overlap is not theft. A presentation of
 * the immediately previous token inside this window continues the session
 * instead of revoking it. Anything older, or a token whose replacement was
 * already used, still revokes the whole session.
 */
export const REFRESH_REUSE_GRACE_MS = 30_000;
import { sendEmail } from "../notifications/notification.service.js";
import { renderTemplate } from "../notifications/templates.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";
import { SIGN_IN_ENTITY_TYPE, signInAuditChanges, type SignInClient } from "./signInAudit.js";

// Sign-in runs before a request transaction exists, so — unlike every other
// module — this service intentionally uses the plain `db` singleton.

async function userWithRole(userId: number) {
  const [row] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      passwordHash: users.passwordHash,
      tokenVersion: users.tokenVersion,
      isActive: users.isActive,
      roleId: users.roleId,
      roleName: roles.name,
      department: users.department,
      supplierId: users.supplierId,
      mfaEnabled: users.mfaEnabled,
      mfaRequiredSince: users.mfaRequiredSince,
      mustChangePassword: users.mustChangePassword,
      pinHash: users.pinHash,
      companyMfaPolicy: company.mfaPolicy,
      companyProfile: company.profile,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(company, sql`true`)
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
function sessionEndFrom(profile: { sessionLengthHours?: unknown } | null | undefined): Date {
  return new Date(Date.now() + sessionLengthMs(sessionLengthHoursFromProfile(profile)));
}

/**
 * The replacement token ends at the same instant as the one it replaces.
 * A row dated further out than the company session length (an older
 * remember-me or 7-day token) is pulled in to that length from now, once,
 * and later refreshes copy that earlier end. Activity does not move it.
 */
function continuingSessionEnd(stored: Date, profile: { sessionLengthHours?: unknown } | null | undefined): Date {
  const cap = Date.now() + sessionLengthMs(sessionLengthHoursFromProfile(profile));
  return stored.getTime() > cap ? new Date(cap) : stored;
}

function sessionExpiredMessage(profile: { sessionLengthHours?: unknown } | null | undefined): string {
  const hours = sessionLengthHoursFromProfile(profile);
  return `Your sign-in expired after ${hours} ${hours === 1 ? "hour" : "hours"}. Please sign in again.`;
}

async function issueTokens(user: {
  id: number;
  roleId: number | null;
  roleName: string | null;
  department: string | null;
  supplierId?: number | null;
  tokenVersion: number;
}, sessionExpiresAt: Date) {
  const jti = randomUUID();
  const accessToken = signAccessToken({
    sub: String(user.id),
    roleId: user.roleId,
    roleName: user.roleName,
    department: user.department,
    supplierId: user.supplierId ?? null,
    tv: user.tokenVersion,
    sid: jti,
  });
  const refreshToken = signRefreshToken({ sub: String(user.id), tokenVersion: user.tokenVersion, jti }, sessionExpiresAt);
  await db.insert(refreshTokens).values({ userId: user.id, jti, expiresAt: sessionExpiresAt, lastActivityAt: new Date() });
  // refreshJti and sessionExpiresAt never reach a response body —
  // auth.controller.ts's withoutRefreshToken strips them alongside
  // refreshToken itself. refreshJti is only for refresh()'s own internal
  // replacedByJti bookkeeping below.
  return { accessToken, refreshToken, refreshJti: jti, sessionExpiresAt };
}

export async function login(input: { email: string; password: string; rememberMe?: boolean; trustedDeviceToken?: string; client?: SignInClient }) {
  const [row] = await db
    .select()
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(company, sql`true`)
    .where(sql`lower(${users.email}) = lower(${input.email})`);
  if (!row) throw AppError.unauthorized("Invalid credentials");

  const user = row.users;
  const roleName = row.roles?.name ?? null;
  if (!user.isActive) throw AppError.forbidden("Account is deactivated");

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

  // When the company has made single sign-on mandatory, passwords no longer work — except for admins, who keep a break-glass way in if the identity provider is down or misconfigured.
  if (roleName !== "admin" && roleName !== "owner") {
    const [sso] = await db.select({ enabled: ssoConnections.enabled, enforce: ssoConnections.enforceSso }).from(ssoConnections);
    if (sso?.enabled && sso.enforce) throw AppError.forbidden("Your organization requires single sign-on. Use the Single sign-on option on the sign-in page.");
  }

  // The password alone is not enough when the account has a second factor, or
  // when the company's policy says it must have one. Nothing is issued (no
  // tokens, no cookie) and the failure counters stay untouched until the
  // second step succeeds — unless this browser was trusted at a previous
  // code entry and that trust has not expired. The password is still required.
  const mfa = evaluateMfa(user, roleName, row.company?.mfaPolicy);
  if (user.mfaEnabled) {
    if (await useTrustedDevice(user.id, input.trustedDeviceToken)) {
      return completeLogin(user, roleName, row.company, null, { method: "trusted_device", client: input.client });
    }
    return { mfaRequired: true as const, mfaToken: signMfaToken(user.id, "verify", user.tokenVersion) };
  }
  if (mfa.state === "blocked") return { mfaEnrollmentRequired: true as const, mfaToken: signMfaToken(user.id, "enroll", user.tokenVersion) };
  if (mfa.required && !user.mfaRequiredSince) await markMfaRequired(user.id);

  return completeLogin(user, roleName, row.company, mfa.state === "grace" ? mfa.graceEndsAt : null, { method: "password", client: input.client });
}

type LoginUserRow = typeof users.$inferSelect;
type LoginCompanyRow = typeof company.$inferSelect | null;

/** Stamps the successful sign-in, clears the failed-attempt counters (and an expired lock), and issues a session that ends at the company session length from now. */
async function completeLogin(
  user: LoginUserRow,
  roleName: string | null,
  co: LoginCompanyRow,
  mfaGraceEndsAt: Date | null = null,
  audit?: { method: "password" | "mfa" | "trusted_device"; client?: SignInClient },
) {
  // Supplier Portal health indicators ("last supplier login")
  // read this; best-effort, never blocks a successful login on its own
  // failure.
  await db.update(users).set({ lastLoginAt: new Date(), failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null }).where(eq(users.id, user.id)).catch(() => undefined);
  if (audit) await recordSignInEvent(user.id, "login", audit.method, audit.client);

  const tokens = await issueTokens({ id: user.id, roleId: user.roleId, roleName, department: user.department, supplierId: user.supplierId, tokenVersion: user.tokenVersion }, sessionEndFrom(co?.profile));
  return {
    user: sanitize({ ...user, roleName }),
    company: co ? { id: co.id, name: co.name, branding: co.branding } : null,
    ...(mfaGraceEndsAt ? { mfaGraceEndsAt: mfaGraceEndsAt.toISOString() } : {}),
    ...tokens,
  };
}

async function loginContext(userId: number) {
  const [row] = await db
    .select()
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(company, sql`true`)
    .where(eq(users.id, userId));
  if (!row) throw AppError.unauthorized("Your sign-in expired. Please start again.");
  if (row.users.lockedUntil && row.users.lockedUntil.getTime() > Date.now()) {
    const minutes = Math.max(1, Math.ceil((row.users.lockedUntil.getTime() - Date.now()) / 60_000));
    throw new AppError(`Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reset your password.`, 429);
  }
  return { user: row.users, roleName: row.roles?.name ?? null, company: row.company };
}

/** Second step of a sign-in: the authenticator (or recovery) code. Wrong codes count toward the same lockout as wrong passwords. */
export async function verifyMfaLogin(mfaToken: string, code: string, _rememberMe = false, trustDevice = false, userAgent?: string, client?: SignInClient) {
  const userId = await verifyMfaToken(mfaToken, "verify");
  const ctx = await loginContext(userId);
  const kind = await checkSecondFactor(userId, code);
  if (!kind) {
    await recordFailedLogin(ctx.user);
    throw AppError.unauthorized("That code didn't work. Try the newest code from your authenticator app, or a recovery code.");
  }
  if (kind === "recovery") {
    await recordAuditTrail(db, { entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_recovery_code_used" }, performedBy: userId }).catch((err) => logger.error("Failed to audit a recovery-code sign-in", { userId, err }));
  }
  const session = await completeLogin(ctx.user, ctx.roleName, ctx.company, null, { method: "mfa", client: client ?? { userAgent } });
  const trustedDeviceToken = trustDevice ? (await issueTrustedDevice(userId, userAgent)).raw : undefined;
  return { ...session, trustedDeviceToken };
}

/** Enrollment that is forced at sign-in (the company's policy requires MFA and the grace period is over): the challenge token stands in for a session. */
export async function startEnrollmentWithToken(mfaToken: string) {
  const userId = await verifyMfaToken(mfaToken, "enroll");
  const ctx = await loginContext(userId);
  return startEnrollment(userId, ctx.user.email);
}

export async function confirmEnrollmentWithToken(mfaToken: string, code: string, _rememberMe = false, trustDevice = false, userAgent?: string, client?: SignInClient) {
  const userId = await verifyMfaToken(mfaToken, "enroll");
  const ctx = await loginContext(userId);
  let recoveryCodes: string[];
  try {
    recoveryCodes = await confirmEnrollment(userId, code);
  } catch (err) {
    if (err instanceof AppError && err.statusCode === 400 && /didn't match/.test(err.message)) await recordFailedLogin(ctx.user);
    throw err;
  }
  await recordAuditTrail(db, { entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_enabled" }, performedBy: userId }).catch((err) => logger.error("Failed to audit MFA enrollment", { userId, err }));

  const [fresh] = await db.select().from(users).where(eq(users.id, userId));
  const session = await completeLogin(fresh ?? ctx.user, ctx.roleName, ctx.company, null, { method: "mfa", client: client ?? { userAgent } });
  const trustedDeviceToken = trustDevice ? (await issueTrustedDevice(userId, userAgent)).raw : undefined;
  return { ...session, recoveryCodes, trustedDeviceToken };
}

/**
 * Counts one wrong password. LOGIN_MAX_FAILURES of them inside
 * LOGIN_FAILURE_WINDOW_MINUTES lock the account for LOGIN_LOCKOUT_MINUTES,
 * leaving an audit entry and emailing the owner. The increment itself is one
 * atomic SQL statement, so parallel guesses can't undercount; only the request
 * that actually flips the account to locked writes the audit entry and email.
 */
async function recordFailedLogin(user: { id: number; email: string; firstFailedLoginAt: Date | null }): Promise<void> {
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

  await recordAuditTrail(db, {
    entityType: "User",
    entityId: user.id,
    action: "status_change",
    changes: { action: "account_locked", reason: "too_many_failed_logins", failedAttempts: after.count, lockedUntil: lockedUntil.toISOString() },
  }).catch((err) => logger.error("Failed to audit an account lockout", { userId: user.id, err }));

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
  // The company's policy may have started requiring MFA since this session began; once the grace period is over the user must go back through sign-in, which walks them through enrollment.
  if (evaluateMfa(full, full.roleName, full.companyMfaPolicy).state === "blocked") {
    throw AppError.unauthorized("Multi-factor authentication setup is required. Please sign in again.");
  }

  // The sign-in ends at the expiresAt stored when it began. Refresh copies
  // that instant; it does not start a new session length. Sitting idle does
  // not end it sooner. A token with no jti (minted before rotation tracking)
  // is capped once at the company session length from now.
  let sessionExpiresAt = sessionEndFrom(full.companyProfile);

  // Security-audit finding (medium): reuse detection. `jti` is only absent
  // on a token minted before this feature existed (graceful degrade — an
  // old in-flight session isn't force-logged-out by this deploy). The claim
  // below is one conditional update, so two overlapping renewals cannot both
  // believe they were first. The loser is a benign overlap when it presents
  // the immediately previous token inside REFRESH_REUSE_GRACE_MS and that
  // token's replacement has not itself been used. A later replay, or a replay
  // of a token the session has already moved past, revokes the whole session
  // the same way logout()/resetPassword() do.
  if (payload.jti) {
    const [tokenRow] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, payload.jti));
    if (!tokenRow || tokenRow.revokedAt) {
      throw AppError.unauthorized("Refresh token has been revoked");
    }
    if (tokenRow.expiresAt.getTime() - Date.now() < 1000) {
      await db.update(refreshTokens).set({ revokedAt: new Date() }).where(and(eq(refreshTokens.id, tokenRow.id), isNull(refreshTokens.revokedAt)));
      throw AppError.unauthorized(sessionExpiredMessage(full.companyProfile));
    }
    sessionExpiresAt = continuingSessionEnd(tokenRow.expiresAt, full.companyProfile);

    const [claimed] = await db
      .update(refreshTokens)
      .set({ usedAt: new Date() })
      .where(and(eq(refreshTokens.id, tokenRow.id), isNull(refreshTokens.usedAt), isNull(refreshTokens.revokedAt)))
      .returning({ id: refreshTokens.id });

    if (!claimed) {
      const [latest] = await db.select().from(refreshTokens).where(eq(refreshTokens.id, tokenRow.id));
      if (!latest || latest.revokedAt) throw AppError.unauthorized("Refresh token has been revoked");
      if (!(await reuseIsBenign(latest))) {
        logger.warn(`Refresh token reuse detected for user ${full.id} (jti ${payload.jti}) — revoking the account's session.`);
        await revokeAllRefreshTokens(full.id);
        await db.update(users).set({ tokenVersion: full.tokenVersion + 1 }).where(eq(users.id, full.id));
        throw AppError.unauthorized("Refresh token has already been used — session revoked for safety");
      }
      logger.info(`Refresh token for user ${full.id} was presented again within the grace window — continuing the session.`);
    }
  }

  const tokens = await issueTokens(full, sessionExpiresAt);
  if (payload.jti) {
    // Keep the first replacement. A grace-window sibling must not overwrite
    // the chain, or a later replay could no longer tell which token came next.
    await db
      .update(refreshTokens)
      .set({ replacedByJti: tokens.refreshJti })
      .where(and(eq(refreshTokens.jti, payload.jti), isNull(refreshTokens.replacedByJti)));
  }
  return { user: sanitize(full), company: await companyInfo(), ...tokens };
}

/** The overlapping renewal of the token that was just rotated — not a stolen token used after the session moved on. */
async function reuseIsBenign(row: { usedAt: Date | null; replacedByJti: string | null; revokedAt: Date | null }): Promise<boolean> {
  if (row.revokedAt || !row.usedAt) return false;
  if (Date.now() - row.usedAt.getTime() > REFRESH_REUSE_GRACE_MS) return false;
  if (!row.replacedByJti) return true;
  const [successor] = await db
    .select({ usedAt: refreshTokens.usedAt, revokedAt: refreshTokens.revokedAt })
    .from(refreshTokens)
    .where(eq(refreshTokens.jti, row.replacedByJti));
  return !!successor && !successor.usedAt && !successor.revokedAt;
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
 * `refresh()`'s own company lookup — mirrors `login()`'s `company` shape
 * exactly. Without this, a browser whose persisted `user`/`company` (see
 * authStore.ts's partialize) is missing — a genuinely new device/browser,
 * or storage cleared without logging out first — could silently refresh
 * into an "authenticated but contextless" session: a real accessToken with
 * no company anywhere in the client, so some screens would fail instead of
 * the client ever having a chance to rebuild it. `useAuthBootstrap` only
 * calls `refreshSession()` (client.ts), which only ever consumed the
 * response's `accessToken` — updated alongside this to also apply `user`/
 * `company` from the same response, so a bootstrap-refresh is self-
 * sufficient on its own, the way an httpOnly-cookie session is supposed to be.
 */
async function companyInfo() {
  const [row] = await db
    .select({ id: company.id, name: company.name, branding: company.branding })
    .from(company);
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
export async function logout(userId: number, client?: SignInClient) {
  await db
    .update(users)
    .set({ tokenVersion: (await currentTokenVersion(userId)) + 1 })
    .where(eq(users.id, userId));
  await revokeAllRefreshTokens(userId);
  await recordSignInEvent(userId, "logout", "session", client);
}

async function recordSignInEvent(userId: number, action: "login" | "logout", method: string, client?: SignInClient) {
  await recordAuditTrail(db, {
    entityType: SIGN_IN_ENTITY_TYPE,
    entityId: userId,
    action: "status_change",
    changes: signInAuditChanges({ action, method, client }),
    performedBy: userId,
  }).catch((err) => logger.error("Failed to audit a sign-in event", { userId, action, err }));
}

/**
 * Ends the sign-in carried by this browser's refresh cookie after the
 * browser was closed and the cookie was put back. Only that refresh token
 * is revoked. Other browsers stay signed in, and the trusted-browser
 * cookie is not touched, so a later sign-in on this browser can still skip
 * the authenticator code.
 */
export async function endBrowserSession(refreshToken: string | undefined): Promise<void> {
  if (!refreshToken) return;
  let payload;
  try {
    payload = verifyRefreshToken(refreshToken);
  } catch {
    return;
  }
  if (!payload.jti) return;
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.jti, payload.jti), isNull(refreshTokens.revokedAt)));
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
  // Older unused links for this person stop working before the new one is stored.
  // The lock is only this user's reset rows, and only for this transaction.
  await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(582021, ${user.id})`);
    await tx
      .update(passwordResetTokens)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(and(eq(passwordResetTokens.userId, user.id), isNull(passwordResetTokens.usedAt)));
    await tx.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashResetToken(rawToken),
      expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
    });
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

  const [owner] = await db.select({ email: users.email, name: users.name, lockedUntil: users.lockedUntil }).from(users).where(eq(users.id, tokenRow.userId));
  await assertPasswordAcceptable(newPassword, { email: owner?.email, name: owner?.name ?? undefined });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const nextTokenVersion = (await currentTokenVersion(tokenRow.userId)) + 1;
  // Proving control of the mailbox also clears any lockout.
  await db
    .update(users)
    .set({ passwordHash, tokenVersion: nextTokenVersion, passwordChangedAt: new Date(), mustChangePassword: false, failedLoginCount: 0, firstFailedLoginAt: null, lockedUntil: null })
    .where(eq(users.id, tokenRow.userId));
  await recordAuditTrail(db, {
    entityType: "User",
    entityId: tokenRow.userId,
    action: "status_change",
    changes: { action: "password_reset", unlockedAccount: !!owner?.lockedUntil && owner.lockedUntil.getTime() > Date.now() },
    performedBy: tokenRow.userId,
  }).catch((err) => logger.error("Failed to audit a password reset", { userId: tokenRow.userId, err }));

  await revokeAllRefreshTokens(tokenRow.userId);
  await revokeAllTrustedDevices(tokenRow.userId, "password_reset", tokenRow.userId);
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, tokenRow.id));
}

/**
 * The signed-in user picks a new password. Other sessions end immediately.
 * This browser stays signed in for the time already left on its session —
 * the window is not restarted. Every trusted device is forgotten.
 * The refresh cookie has to prove this browser's current sign-in. A missing
 * or unusable cookie does not get a new session.
 */
export async function changePassword(userId: number, currentPassword: string, newPassword: string, currentRefreshToken: string | undefined) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  if (!user || !user.isActive) throw AppError.unauthorized("Session is no longer valid");
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw new AppError("Too many failed attempts. Try again later.", 429);
  }
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    await recordFailedLogin(user);
    throw AppError.unauthorized("Current password is incorrect.");
  }
  if (await bcrypt.compare(newPassword, user.passwordHash)) {
    throw AppError.badRequest("Choose a different password than the one you use now.");
  }
  await assertPasswordAcceptable(newPassword, { email: user.email, name: user.name ?? undefined });

  let payload;
  try {
    payload = verifyRefreshToken(currentRefreshToken ?? "");
  } catch {
    throw AppError.unauthorized("Your sign-in expired. Please sign in again.");
  }
  if (Number(payload.sub) !== userId || !payload.jti) {
    throw AppError.unauthorized("Your sign-in expired. Please sign in again.");
  }
  const [sessionRow] = await db.select().from(refreshTokens).where(eq(refreshTokens.jti, payload.jti));
  if (!sessionRow || sessionRow.revokedAt || sessionRow.userId !== userId || sessionRow.expiresAt.getTime() <= Date.now() + 1000) {
    throw AppError.unauthorized("Your sign-in expired. Please sign in again.");
  }
  const [sessionCompany] = await db.select({ profile: company.profile }).from(company);
  const sessionExpiresAt = continuingSessionEnd(sessionRow.expiresAt, sessionCompany?.profile);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const nextTokenVersion = user.tokenVersion + 1;
  await db
    .update(users)
    .set({
      passwordHash,
      tokenVersion: nextTokenVersion,
      passwordChangedAt: new Date(),
      mustChangePassword: false,
      failedLoginCount: 0,
      firstFailedLoginAt: null,
      lockedUntil: null,
    })
    .where(eq(users.id, userId));

  await revokeAllRefreshTokens(userId);
  await revokeAllTrustedDevices(userId, "password_changed", userId);

  const full = await userWithRole(userId);
  if (!full) throw AppError.unauthorized("Session is no longer valid");
  const tokens = await issueTokens(
    { id: full.id, roleId: full.roleId, roleName: full.roleName, department: full.department, supplierId: full.supplierId, tokenVersion: full.tokenVersion },
    sessionExpiresAt,
  );

  await recordAuditTrail(db, {
    entityType: "User",
    entityId: userId,
    action: "status_change",
    changes: { action: "password_changed" },
    performedBy: userId,
  }).catch((err) => logger.error("Failed to audit a password change", { userId, err }));

  const notice = renderTemplate("password_changed", { resetUrl: `${env.FRONTEND_URL}/forgot-password` });
  await sendEmail({ to: user.email, subject: notice.subject, body: notice.body }).catch((err) => logger.error("Failed to send the password-changed email", { userId, err }));

  return { user: sanitize(full), company: await companyInfo(), ...tokens };
}

export async function me(userId: number) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  return sanitize(full);
}

/** Everything a session response may show about a user — never the password hash, the PIN hash, the MFA secret, or lockout bookkeeping. */
function sanitize<T extends { passwordHash?: string; pinHash?: string | null }>(user: T) {
  const {
    passwordHash: _passwordHash,
    pinHash,
    pinFailedCount: _pinFailed,
    pinLockedUntil: _pinLocked,
    mfaSecretEncrypted: _mfaSecret,
    mfaLastUsedStep: _mfaStep,
    failedLoginCount: _failedCount,
    firstFailedLoginAt: _firstFailed,
    lockedUntil: _lockedUntil,
    companyMfaPolicy: _policy,
    companyProfile: _companyProfile,
    ...rest
  } = user as T & Record<string, unknown>;
  return { ...rest, pinSet: typeof pinHash === "string" && pinHash.length > 0 };
}

// ---- Signed-in MFA management (My account) --------------------------------------------------------------------------------------------------

export async function mfaStatus(userId: number) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  const mfa = evaluateMfa(full, full.roleName, full.companyMfaPolicy);
  return {
    enabled: mfa.enabled,
    required: mfa.required,
    state: mfa.state,
    graceEndsAt: mfa.graceEndsAt ? mfa.graceEndsAt.toISOString() : null,
    policy: full.companyMfaPolicy ?? null,
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
  await recordAuditTrail(db, { entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_enabled" }, performedBy: userId }).catch((err) => logger.error("Failed to audit MFA enrollment", { userId, err }));

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
  await reverify(userId, password, code);
  const full = await userWithRole(userId);
  if (full && evaluateMfa({ mfaEnabled: false, mfaRequiredSince: full.mfaRequiredSince }, full.roleName, full.companyMfaPolicy).required) {
    throw AppError.forbidden("Your organization requires multi-factor authentication, so it can't be turned off.");
  }
  await clearMfa(userId);
  await revokeAllTrustedDevices(userId, "mfa_disabled", userId);
  await recordAuditTrail(db, { entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_disabled" }, performedBy: userId }).catch((err) => logger.error("Failed to audit MFA being turned off", { userId, err }));

}

export async function newRecoveryCodes(userId: number, password: string, code: string) {
  const user = await reverify(userId, password, code);
  const recoveryCodes = await regenerateRecoveryCodes(userId);
  await recordAuditTrail(db, { entityType: "User", entityId: userId, action: "status_change", changes: { action: "mfa_recovery_codes_regenerated" }, performedBy: userId }).catch((err) => logger.error("Failed to audit recovery-code regeneration", { userId, err }));

  return { recoveryCodes };
}

/** Finishes a sign-in the identity provider already vouched for: the provider did the authenticating (including any MFA it enforces), so the local password/lockout/MFA steps do not apply. */
export async function startSessionForSsoUser(userId: number) {
  const [row] = await db.select().from(users).leftJoin(roles, eq(users.roleId, roles.id)).leftJoin(company, sql`true`).where(eq(users.id, userId));
  if (!row || !row.users.isActive) throw AppError.forbidden("Account is deactivated");
  return completeLogin(row.users, row.roles?.name ?? null, row.company);
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
