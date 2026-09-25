import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// RFC 6238 time-based one-time passwords (HMAC-SHA1, 6 digits, 30 s step) — the
// parameters every authenticator app (Google/Microsoft Authenticator, Authy,
// 1Password, ...) implements. Small and fully specified, so it is written
// directly on node:crypto and pinned to the RFC's own test vectors in
// test/totp.test.ts rather than pulling in a dependency.

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Accept the previous and next step too, to tolerate clock drift between the phone and the server. */
const TOTP_WINDOW = 1;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid base32 character");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** 160-bit secret (the RFC's recommended size for SHA-1), base32 so it can be typed into an app by hand. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function totpCounter(atMs: number = Date.now()): number {
  return Math.floor(atMs / 1000 / TOTP_STEP_SECONDS);
}

/** The code for a given counter (RFC 4226 dynamic truncation). */
export function totpAt(secretBase32: string, counter: number, digits: number = TOTP_DIGITS): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac("sha1", base32Decode(secretBase32)).update(buf).digest();
  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary = ((hmac[offset]! & 0x7f) << 24) | (hmac[offset + 1]! << 16) | (hmac[offset + 2]! << 8) | hmac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, "0");
}

/**
 * Returns the matched counter, or null. `lastUsedCounter` blocks replay: a code
 * (or any earlier one) that already signed someone in cannot be used again,
 * even inside its validity window.
 */
export function verifyTotp(secretBase32: string, code: string, lastUsedCounter: number | null = null, atMs: number = Date.now()): number | null {
  const cleaned = code.replace(/\s/g, "");
  if (!/^\d{6}$/.test(cleaned)) return null;
  const now = totpCounter(atMs);
  let matched: number | null = null;
  for (let c = now - TOTP_WINDOW; c <= now + TOTP_WINDOW; c++) {
    const expected = Buffer.from(totpAt(secretBase32, c));
    // Compare every candidate (no early exit) so timing does not reveal which step matched.
    if (timingSafeEqual(expected, Buffer.from(cleaned)) && matched === null) matched = c;
  }
  if (matched === null) return null;
  if (lastUsedCounter !== null && matched <= lastUsedCounter) return null;
  return matched;
}

export function otpauthUri(secretBase32: string, accountName: string, issuer = "AccuQual"): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({ secret: secretBase32, issuer, algorithm: "SHA1", digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}
