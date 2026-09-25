import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Per-device ingest credentials, so a real PLC/sensor can push readings
 * without a user's short-lived login token. A key looks like
 * `<deviceRowId>.<64 hex chars>`: the id half only locates the device row,
 * the secret half authenticates it. Only the SHA-256 of the secret is stored
 * (iot_devices.api_key_hash) — plain SHA-256 is right here, not bcrypt,
 * because the secret is 256 bits of random data (nothing to brute-force or
 * dictionary-attack) and a device may authenticate hundreds of times a minute.
 */
const KEY_PATTERN = /^(\d{1,10})\.([0-9a-f]{64})$/;

export function hashDeviceSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function generateDeviceKey(deviceRowId: number): { apiKey: string; hash: string } {
  const secret = randomBytes(32).toString("hex");
  return { apiKey: `${deviceRowId}.${secret}`, hash: hashDeviceSecret(secret) };
}

export function parseDeviceKey(header: string | undefined): { deviceRowId: number; secret: string } | null {
  const match = header?.trim().match(KEY_PATTERN);
  if (!match) return null;
  return { deviceRowId: Number(match[1]), secret: match[2]! };
}

export function deviceSecretMatches(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashDeviceSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
