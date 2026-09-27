import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { env } from "../../config/env.js";
import { db } from "../../db/index.js";
import { trustedDevices } from "../../drizzle/schema/trustedDevices.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { logger } from "../../utils/logger.js";

/** Fixed at creation. Signing in with the device does not move this. */
export const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function hashTrustedDeviceToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

function deviceCookieKey(): Buffer {
  return createHash("sha256").update(`accuqual-device-cookie:${env.JWT_REFRESH_SECRET}`).digest();
}

/** Ciphertext for the browser cookie. The database stores only a hash of the plaintext. A value that does not decrypt asks for the authenticator code again. */
export function encryptDeviceCookie(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deviceCookieKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptDeviceCookie(stored: string): string | undefined {
  const [iv, authTag, ciphertext] = stored.split(".");
  if (!iv || !authTag || !ciphertext) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", deviceCookieKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

/** A short label for the settings list. The raw User-Agent string is not stored. */
export function deviceLabelFromUserAgent(userAgent: string | undefined): string {
  const ua = (userAgent ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
  if (!ua) return "Unknown browser";
  let browser = "Browser";
  if (/Edg\//.test(ua)) browser = "Edge";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/Safari\//.test(ua)) browser = "Safari";
  // iPhone/iPad before Mac: those UAs also contain "like Mac OS X".
  let os = "";
  if (/iPhone|iPad/.test(ua)) os = "iPhone or iPad";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows/.test(ua)) os = "Windows";
  else if (/Mac OS X|Macintosh/.test(ua)) os = "Mac";
  else if (/Linux/.test(ua)) os = "Linux";
  return (os ? `${browser} on ${os}` : browser).slice(0, 120);
}

async function audit(userId: number, changes: Record<string, unknown>, performedBy?: number) {
  await recordAuditTrail(db, { entityType: "User", entityId: userId, action: "status_change", changes, performedBy: performedBy ?? userId }).catch((err) =>
    logger.error("Failed to audit a trusted-device event", { userId, action: changes.action, err }),
  );
}

/** New random token. Only the hash is stored. The raw value goes in the cookie and is not returned again. */
export async function issueTrustedDevice(userId: number, userAgent: string | undefined): Promise<{ raw: string; id: number }> {
  const raw = randomBytes(32).toString("base64url");
  const label = deviceLabelFromUserAgent(userAgent);
  const expiresAt = new Date(Date.now() + TRUSTED_DEVICE_TTL_MS);
  const [row] = await db
    .insert(trustedDevices)
    .values({ userId, tokenHash: hashTrustedDeviceToken(raw), label, expiresAt })
    .returning({ id: trustedDevices.id });
  await audit(userId, { action: "trusted_device_created", deviceId: row!.id, label, expiresAt: expiresAt.toISOString() });
  return { raw, id: row!.id };
}

/**
 * Password sign-in already succeeded for this user. A matching unexpired,
 * unrevoked token skips the authenticator step. last_used_at moves; expires_at
 * does not. A token that belongs to someone else does not match.
 */
export async function useTrustedDevice(userId: number, rawToken: string | undefined): Promise<boolean> {
  if (!rawToken) return false;
  const now = new Date();
  const [row] = await db
    .update(trustedDevices)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(trustedDevices.userId, userId),
        eq(trustedDevices.tokenHash, hashTrustedDeviceToken(rawToken)),
        isNull(trustedDevices.revokedAt),
        gt(trustedDevices.expiresAt, now),
      ),
    )
    .returning({ id: trustedDevices.id });
  if (!row) return false;
  await audit(userId, { action: "trusted_device_used", deviceId: row.id });
  return true;
}

export async function listTrustedDevices(userId: number, currentToken: string | undefined) {
  const currentHash = currentToken ? hashTrustedDeviceToken(currentToken) : null;
  const rows = await db
    .select({
      id: trustedDevices.id,
      label: trustedDevices.label,
      createdAt: trustedDevices.createdAt,
      expiresAt: trustedDevices.expiresAt,
      lastUsedAt: trustedDevices.lastUsedAt,
      tokenHash: trustedDevices.tokenHash,
    })
    .from(trustedDevices)
    .where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt), gt(trustedDevices.expiresAt, new Date())))
    .orderBy(desc(trustedDevices.createdAt));
  return rows.map((row) => ({
    id: row.id,
    label: row.label,
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    lastUsedAt: row.lastUsedAt,
    current: currentHash !== null && row.tokenHash === currentHash,
  }));
}

/** Revokes one of this user's devices. Returns its hash so the caller can clear the cookie when it is the current browser. */
export async function revokeTrustedDevice(userId: number, deviceId: number): Promise<{ tokenHash: string } | null> {
  const [row] = await db
    .update(trustedDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(trustedDevices.id, deviceId), eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)))
    .returning({ tokenHash: trustedDevices.tokenHash, label: trustedDevices.label });
  if (!row) return null;
  await audit(userId, { action: "trusted_device_revoked", deviceId, label: row.label });
  return { tokenHash: row.tokenHash };
}

/** Password changes and MFA being turned off or reset forget every trusted browser. */
export async function revokeAllTrustedDevices(userId: number, reason: string, performedBy?: number): Promise<number> {
  const rows = await db
    .update(trustedDevices)
    .set({ revokedAt: new Date() })
    .where(and(eq(trustedDevices.userId, userId), isNull(trustedDevices.revokedAt)))
    .returning({ id: trustedDevices.id });
  if (rows.length > 0) {
    await audit(userId, { action: "trusted_devices_revoked", reason, count: rows.length }, performedBy);
  }
  return rows.length;
}
