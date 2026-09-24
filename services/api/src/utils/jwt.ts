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
  // users.tokenVersion at issue time — requireAuth compares it with the live value, so logout, a password reset, a role change or a deactivation end this token at once instead of at its expiry. Optional so tokens issued before this field existed still verify.
  tv?: number;
}

export interface RefreshTokenPayload {
  sub: string;
  tokenVersion: number;
  // Security-audit finding (medium): unique per issued token, tracked in
  // the new refresh_tokens table — lets auth.service.ts's refresh() detect
  // a token being redeemed a second time after it was already rotated
  // (see refreshTokens.ts's own comment). Optional only so any code that
  // still verifies an old, already-issued token from before this field
  // existed doesn't throw on a missing key — every new token this app
  // issues from here on always sets it.
  jti?: string;
  // Set when the user ticked "Remember me" — the session lives (and may sit idle) for REMEMBER_ME_TTL instead of the normal limits.
  rm?: boolean;
}

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  const options: SignOptions = { expiresIn: (payload.rm ? env.REMEMBER_ME_TTL : env.JWT_REFRESH_TTL) as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

// jsonwebtoken's own `ms`-style vocabulary (env.ts's JWT_REFRESH_TTL) —
// reused here so the refresh cookie's Max-Age tracks the same TTL as the
// token it holds, without adding a dependency on the transitive `ms`
// package. Falls back to 7 days on a format this doesn't recognize (e.g. a
// bare "cookie" value some future TTL string might use) rather than
// crashing the auth module over a cookie's UX-only expiry hint — the JWT's
// own signature is still what actually enforces expiry.
function parseDurationMs(ttl: string): number {
  const match = /^(\d+)\s*(s|m|h|d)?$/i.exec(ttl.trim());
  if (!match) return 7 * 24 * 60 * 60 * 1000;
  const value = Number(match[1]);
  const unitMs = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2]?.toLowerCase() ?? "s"] ?? 1000;
  return value * unitMs;
}

export const REFRESH_TOKEN_TTL_MS = parseDurationMs(env.JWT_REFRESH_TTL);
export const REMEMBER_ME_TTL_MS = parseDurationMs(env.REMEMBER_ME_TTL);

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
