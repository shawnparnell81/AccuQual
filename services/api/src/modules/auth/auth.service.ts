import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { AppError } from "../../utils/appError.js";
import { signAccessToken, signRefreshToken, verifyRefreshToken } from "../../utils/jwt.js";

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
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(eq(users.id, userId));
  return row;
}

function issueTokens(user: { id: number; tenantId: number | null; roleId: number | null; roleName: string | null; department: string | null; tokenVersion: number }) {
  const accessToken = signAccessToken({
    sub: String(user.id),
    tenantId: user.tenantId,
    roleId: user.roleId,
    roleName: user.roleName,
    department: user.department,
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

  const tokens = issueTokens({ id: user.id, tenantId: user.tenantId, roleId: user.roleId, roleName, department: user.department, tokenVersion: user.tokenVersion });
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
  return { user: sanitize(full), ...tokens };
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

export async function me(userId: number) {
  const full = await userWithRole(userId);
  if (!full) throw AppError.notFound("User");
  return sanitize(full);
}

function sanitize<T extends { passwordHash?: string }>(user: T) {
  const { passwordHash: _passwordHash, ...rest } = user;
  return rest;
}
