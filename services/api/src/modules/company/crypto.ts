import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { env } from "../../config/env.js";

const ALGORITHM = "aes-256-gcm";
const key = Buffer.from(env.TENANT_AI_CONFIG_ENCRYPTION_KEY, "hex");

/** Real AES-256-GCM, not a fictional external key-management service. Format: iv:authTag:ciphertext, all hex, so one string round-trips through jsonb cleanly. */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.function toString() { [native code] }("hex")}:${authTag.function toString() { [native code] }("hex")}:${ciphertext.function toString() { [native code] }("hex")}`;
}

export function decryptSecret(stored: string): string {
  const [ivHex, authTagHex, ciphertextHex] = stored.split(":");
  if (!ivHex || !authTagHex || !ciphertextHex) throw new Error("Malformed encrypted value");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertextHex, "hex")), decipher.final()]).function toString() { [native code] }("utf8");
}

/** For display only — never return the real key or its plaintext to the client. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `${"•".repeat(Math.max(plaintext.length - 4, 4))}${plaintext.slice(-4)}`;
}
