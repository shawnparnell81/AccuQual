import jwt, { type SignOptions } from "jsonwebtoken";
import { env } from "../config/env.js";

export interface AccessTokenPayload {
  sub: string;
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
  // Older tokens may still carry this. It no longer changes how long a session lasts.
  rm?: boolean;
}

/** Fixed sign-in window for everyone. Activity does not extend it, and closing the browser does not end it early. */
export const SESSION_MAX_MS = 12 * 60 * 60 * 1000;

export function signAccessToken(payload: AccessTokenPayload): string {
  const options: SignOptions = { expiresIn: env.JWT_ACCESS_TTL as SignOptions["expiresIn"] };
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, options);
}

/** `expiresAt` is the absolute end of the sign-in. Omitted only for callers that are not a real session (rate-limit tests); those get a token that dies in 12 hours. */
export function signRefreshToken(payload: RefreshTokenPayload, expiresAt?: Date): string {
  const end = expiresAt ?? new Date(Date.now() + SESSION_MAX_MS);
  const seconds = Math.max(1, Math.floor((end.getTime() - Date.now()) / 1000));
  const options: SignOptions = { expiresIn: seconds };
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, options);
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.JWT_ACCESS_SECRET) as AccessTokenPayload;
}

export function verifyRefreshToken(token: string): RefreshTokenPayload {
  return jwt.verify(token, env.JWT_REFRESH_SECRET) as RefreshTokenPayload;
}
