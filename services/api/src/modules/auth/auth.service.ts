import bcrypt from "bcryptjs";
import { randomBytes, createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { passwordResetTokens } from "../../drizzle/schema/passwordResetTokens.js";
import { AppError } from "../../utils/appError.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";
import { sendEmail } from "../notifications/notification.service.js";
import { renderTemplate } from "../notifications/templates.js";
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
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId));
  return row;
}

function issueTokens(user: {
  id: number;
  tenantId: number | null;
  roleId: number | null;
  roleName: string | null;
  department: string | null;
  supplierId?: number | null;
  tokenVersion: number;
}) {
  const accessToken = signAccessToken({
    sub: String(user.id),
    tenantId: user.tenantId,
    roleId: user.roleId,
    roleName: user.roleName,
    department: user.department,
    supplierId: user.supplierId ?? null,
  });
  const refreshToken = signRefreshToken({ sub: String(user.id), tokenVersion: user.tokenVersion });
  return { accessToken, refreshToken };
}

export async function register(input: { email: string; password: string; name?: string; tenantCode: string }) {
  const [tenant] = await db.select().from(tenants).where(eq(tenants.code, input.tenantCode));
  if (!tenant || tenant.status !== "active" || tenant.isDeleted) {
    throw AppError.badRequest("Unknown or inactive tenant code");
  }

  const existing = await db.select().from(users).where(eq(users.email, input.email));
  if (existing.length > 0) throw AppError.badRequest("Email already registered");

  const passwordHash = await bcrypt.hash(input.password, 10);
  const [created] = await db
    .insert(users)
    .values({ email: input.email, passwordHash, name: input.name, tenantId: tenant.id })
    .returning();
  if (!created) throw new AppError("Failed to create user", 500);

  const full = await userWithRole(created.id);
  if (!full) throw new AppError("Failed to create user", 500);
  const tokens = issueTokens(full);
  return { user: sanitize(full), tenant: { id: tenant.id, name: tenant.name, code: tenant.code, branding: tenant.branding }, ...tokens };
}

export async function login(input: { email: string; password: string }) {
  const [row] = await db
    .select()
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .leftJoin(tenants, eq(users.tenantId, tenants.id))
    .where(eq(users.email, input.email));
  if (!row) throw AppError.unauthorized("Invalid credentials");

  const user = row.users;
  const roleName = row.roles?.name ?? null;
  if (!user.isActive) throw AppError.forbidden("Account is deactivated");
  if (user.tenantId && (!row.tenants || row.tenants.status !== "active" || row.tenants.isDeleted)) {
    throw AppError.forbidden("Tenant is inactive");
  }

  const valid = await bcrypt.compare(input.password, user.passwordHash);
  if (!valid) throw AppError.unauthorized("Invalid credentials");

  // Phase 7 — Supplier Portal health indicators ("last supplier login")
  // read this; best-effort, never blocks a successful login on its own
  // failure.
  await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id)).catch(() => undefined);

  const tokens = issueTokens({ id: user.id, tenantId: user.tenantId, roleId: user.roleId, roleName, department: user.department, supplierId: user.supplierId, tokenVersion: user.tokenVersion });
  return { user: sanitize({ ...user, roleName }), tenant: row.tenants ? { id: row.tenants.id, name: row.tenants.name, code: row.tenants.code, branding: row.tenants.branding } : null, ...tokens };
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

  const tokens = issueTokens(full);
  const tenant = full.tenantId ? await tenantById(full.tenantId) : null;
  return { user: sanitize(full), tenant, ...tokens };
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

/** Bumps the user's tokenVersion, invalidating every outstanding refresh token. */
export async function logout(userId: number) {
  await db
    .update(users)
    .set({ tokenVersion: (await currentTokenVersion(userId)) + 1 })
    .where(eq(users.id, userId));
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
  const [user] = await db.select().from(users).where(eq(users.email, email));
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

/** Bumps tokenVersion too — a resets password revokes every outstanding refresh token, the same way logout() does. */
export async function resetPassword(rawToken: string, newPassword: string): Promise<void> {
  const [tokenRow] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.tokenHash, hashResetToken(rawToken)));

  if (!tokenRow || tokenRow.usedAt || tokenRow.expiresAt.getTime() < Date.now()) {
    throw AppError.badRequest("This reset link is invalid or has expired.");
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  const nextTokenVersion = (await currentTokenVersion(tokenRow.userId)) + 1;
  await db.update(users).set({ passwordHash, tokenVersion: nextTokenVersion }).where(eq(users.id, tokenRow.userId));
  await db.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, tokenRow.id));
}

export async function me(userId: number) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  return sanitize(full);
}

function sanitize<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
