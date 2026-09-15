import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  sub: string;
  tenantId: number | null; // null only for platform admins (see modules/platform)
  roleId: number | null;
  roleName: string | null;
  department: string | null;
  // Set only for roleName:"supplier" (Supplier Portal) logins — see
  // users.ts's supplierId column comment. Optional (not just nullable) so
  // every pre-existing signAccessToken call site (auth.service.ts's other
  // login paths, every integration test's signAccessToken helper) keeps
  // compiling unchanged; verifyAccessToken callers must still treat a
  // missing value the same as null.
  supplierId?: number | null;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenVersion: number;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_REFRESH_TTL as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
