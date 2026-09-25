import { createHash, randomBytes } from "node:crypto";
import jwt from "jsonwebtoken";
import { and, eq, isNull, or, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { mfaRecoveryCodes } from "../../drizzle/schema/mfaRecoveryCodes.js";
import { env } from "../../config/env.js";
import { AppError } from "../../utils/appError.js";
import { base32Encode, generateTotpSecret, otpauthUri, totpCounter, verifyTotp } from "../../utils/totp.js";
import { decryptSecret, encryptSecret } from "../company/crypto.js";

export type MfaPolicy = "optional" | "admins" | "all";
export const MFA_POLICIES: readonly MfaPolicy[] = ["optional", "admins", "all"];

const RECOVERY_CODE_COUNT = 10;

/** Roles the "admins" policy covers. platform_admin is always covered, whatever the tenant policy says. */
const ADMIN_ROLES = new Set(["admin", "platform_admin"]);

export interface MfaEvaluation {
  enabled: boolean;
  required: boolean;
  /** ok = nothing to do; grace = must enroll by graceEndsAt but may sign in; blocked = must enroll before getting in. */
  state: "ok" | "grace" | "blocked";
  graceEndsAt: Date | null;
}

export function mfaRequiredFor(roleName: string | null, tenantPolicy: string | null | undefined): boolean {
  if (roleName === "platform_admin") return true;
  if (tenantPolicy === "all") return true;
  if (tenantPolicy === "optional") return false;
  return roleName !== null && ADMIN_ROLES.has(roleName); // "admins" — also the default for an unknown value, failing toward safer
}

export function evaluateMfa(user: { mfaEnabled: boolean; mfaRequiredSince: Date | null }, roleName: string | null, tenantPolicy: string | null | undefined, now: Date = new Date()): MfaEvaluation {
  const required = mfaRequiredFor(roleName, tenantPolicy);
  if (user.mfaEnabled) return { enabled: true, required, state: "ok", graceEndsAt: null };
  if (!required) return { enabled: false, required: false, state: "ok", graceEndsAt: null };
  if (roleName === "platform_admin" || env.MFA_ENROLLMENT_GRACE_DAYS === 0) return { enabled: false, required: true, state: "blocked", graceEndsAt: null };
  const since = user.mfaRequiredSince ?? now;
  const graceEndsAt = new Date(since.getTime() + env.MFA_ENROLLMENT_GRACE_DAYS * 86_400_000);
  return { enabled: false, required: true, state: graceEndsAt.getTime() > now.getTime() ? "grace" : "blocked", graceEndsAt };
}

/** Starts the grace clock the first time a user is seen to need MFA. Best-effort. */
export async function markMfaRequired(userId: number): Promise<void> {
  await db.update(users).set({ mfaRequiredSince: new Date() }).where(and(eq(users.id, userId), isNull(users.mfaRequiredSince))).catch(() => undefined);
}

// ---- Short-lived challenge tokens: "the password was right, the second step is pending" -------------------------------------------------

export type MfaTokenPurpose = "verify" | "enroll";
const MFA_TOKEN_TTL: Record<MfaTokenPurpose, string> = { verify: "5m", enroll: "15m" };
// Distinct signing secret so a challenge token can never be mistaken for an access token (or the reverse).
const mfaTokenSecret = `${env.JWT_ACCESS_SECRET}:mfa-challenge`;

export function signMfaToken(userId: number, purpose: MfaTokenPurpose, tokenVersion: number): string {
  return jwt.sign({ sub: String(userId), purpose, tv: tokenVersion }, mfaTokenSecret, { expiresIn: MFA_TOKEN_TTL[purpose] as jwt.SignOptions["expiresIn"] });
}

export async function verifyMfaToken(token: string, purpose: MfaTokenPurpose): Promise<number> {
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(token, mfaTokenSecret) as jwt.JwtPayload;
  } catch {
    throw AppError.unauthorized("Your sign-in expired. Please start again.");
  }
  if (payload.purpose !== purpose) throw AppError.unauthorized("Your sign-in expired. Please start again.");
  const userId = Number(payload.sub);
  const [live] = await db.select({ isActive: users.isActive, tokenVersion: users.tokenVersion }).from(users).where(eq(users.id, userId));
  if (!live || !live.isActive || live.tokenVersion !== payload.tv) throw AppError.unauthorized("Your sign-in expired. Please start again.");
  return userId;
}

// ---- Enrollment -------------------------------------------------------------------------------------------------------------------------

/** Generates a fresh secret and stores it (encrypted) as PENDING — it only protects the account once confirmEnrollment() proves a code. */
export async function startEnrollment(userId: number, accountName: string): Promise<{ secret: string; otpauthUri: string }> {
  const [row] = await db.select({ mfaEnabled: users.mfaEnabled }).from(users).where(eq(users.id, userId));
  if (!row) throw AppError.notFound("User");
  if (row.mfaEnabled) throw AppError.badRequest("Multi-factor authentication is already turned on for this account.");
  const secret = generateTotpSecret();
  await db.update(users).set({ mfaSecretEncrypted: encryptSecret(secret) }).where(eq(users.id, userId));
  return { secret, otpauthUri: otpauthUri(secret, accountName) };
}

function newRecoveryCode(): string {
  const raw = base32Encode(randomBytes(7)).slice(0, 10); // 10 base32 chars ≈ 50 bits
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function hashRecoveryCode(code: string): string {
  return createHash("sha256").update(code.toUpperCase().replace(/[^A-Z2-7]/g, "")).digest("hex");
}

/** Replaces the user's recovery codes with a fresh set and returns them in plain text — the only time they are ever visible. */
export async function regenerateRecoveryCodes(userId: number): Promise<string[]> {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
  await db.insert(mfaRecoveryCodes).values(codes.map((code) => ({ userId, codeHash: hashRecoveryCode(code) })));
  return codes;
}

export async function recoveryCodesRemaining(userId: number): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(mfaRecoveryCodes).where(and(eq(mfaRecoveryCodes.userId, userId), isNull(mfaRecoveryCodes.usedAt)));
  return row?.n ?? 0;
}

/** Proves the user's authenticator works by checking a first code, then turns MFA on and issues recovery codes. */
export async function confirmEnrollment(userId: number, code: string): Promise<string[]> {
  const [row] = await db.select({ mfaEnabled: users.mfaEnabled, secret: users.mfaSecretEncrypted }).from(users).where(eq(users.id, userId));
  if (!row) throw AppError.notFound("User");
  if (row.mfaEnabled) throw AppError.badRequest("Multi-factor authentication is already turned on for this account.");
  if (!row.secret) throw AppError.badRequest("Start setup first to get a secret for your authenticator app.");
  const step = verifyTotp(decryptSecret(row.secret), code);
  if (step === null) throw AppError.badRequest("That code didn't match. Check the time on your phone and try the newest code.");
  await db.update(users).set({ mfaEnabled: true, mfaEnrolledAt: new Date(), mfaLastUsedStep: step }).where(eq(users.id, userId));
  return regenerateRecoveryCodes(userId);
}

// ---- Sign-in ----------------------------------------------------------------------------------------------------------------------------

/**
 * Checks a second-factor entry: a 6-digit authenticator code, or one of the
 * one-time recovery codes (which is consumed). Returns which kind matched, or
 * null. A TOTP step is claimed atomically, so a code can sign in exactly once.
 */
export async function checkSecondFactor(userId: number, entry: string): Promise<"totp" | "recovery" | null> {
  const [row] = await db.select({ secret: users.mfaSecretEncrypted, enabled: users.mfaEnabled, last: users.mfaLastUsedStep }).from(users).where(eq(users.id, userId));
  if (!row?.enabled || !row.secret) return null;

  const trimmed = entry.trim();
  if (/^\d[\d\s]{5,}$/.test(trimmed)) {
    const step = verifyTotp(decryptSecret(row.secret), trimmed, row.last);
    if (step === null) return null;
    const [claimed] = await db
      .update(users)
      .set({ mfaLastUsedStep: step })
      .where(and(eq(users.id, userId), or(isNull(users.mfaLastUsedStep), lt(users.mfaLastUsedStep, step))))
      .returning({ id: users.id });
    return claimed ? "totp" : null;
  }

  if (!/^[A-Za-z2-7]{5}-?[A-Za-z2-7]{5}$/.test(trimmed)) return null;
  const [used] = await db
    .update(mfaRecoveryCodes)
    .set({ usedAt: new Date() })
    .where(and(eq(mfaRecoveryCodes.userId, userId), eq(mfaRecoveryCodes.codeHash, hashRecoveryCode(trimmed)), isNull(mfaRecoveryCodes.usedAt)))
    .returning({ id: mfaRecoveryCodes.id });
  return used ? "recovery" : null;
}

/** Turns MFA off and forgets the secret and every recovery code. Callers decide who may do this (the user themselves, subject to policy; or an admin reset). */
export async function clearMfa(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ mfaEnabled: false, mfaSecretEncrypted: null, mfaEnrolledAt: null, mfaLastUsedStep: null, mfaRequiredSince: null })
    .where(eq(users.id, userId));
  await db.delete(mfaRecoveryCodes).where(eq(mfaRecoveryCodes.userId, userId));
}

export { totpCounter };
