import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Request } from "express";
import { env } from "../../config/env.js";
import { verifyRefreshToken } from "../../utils/jwt.js";

export const REFRESH_COOKIE_NAME = "accuqual_rt";

function refreshCookieKey(): Buffer {
  return createHash("sha256").update(`accuqual-refresh-cookie:${env.JWT_REFRESH_SECRET}`).digest();
}

/** Ciphertext for the browser cookie. The signed token itself stays server-side in the sense that the cookie value is not the token. */
export function encryptRefreshCookie(refreshToken: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", refreshCookieKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(refreshToken, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${authTag.toString("base64url")}.${ciphertext.toString("base64url")}`;
}

export function decryptRefreshCookie(stored: string): string | undefined {
  const [iv, authTag, ciphertext] = stored.split(".");
  if (!iv || !authTag || !ciphertext) return undefined;
  try {
    const decipher = createDecipheriv("aes-256-gcm", refreshCookieKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(authTag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return undefined;
  }
}

/**
 * A cookie written by this deploy decrypts to the refresh token. A cookie
 * written before encryption was a refresh JWT; it still opens until the next
 * renewal replaces it. Anything that does not verify is ignored.
 */
export function openRefreshCookie(stored: string | undefined): string | undefined {
  if (!stored) return undefined;
  const candidate = decryptRefreshCookie(stored) ?? stored;
  try {
    verifyRefreshToken(candidate);
    return candidate;
  } catch {
    return undefined;
  }
}

export function refreshCookieFrom(req: Request): string | undefined {
  const value = req.cookies?.[REFRESH_COOKIE_NAME];
  return openRefreshCookie(typeof value === "string" ? value : undefined);
}
