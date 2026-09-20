import { createHash } from "node:crypto";
import { z } from "zod";
import { env } from "../config/env.js";
import { AppError } from "./appError.js";
import { logger } from "./logger.js";

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

// The passwords attackers try first. Not a substitute for the breach check below — this is the offline floor that still works when that service is unreachable.
const COMMON_PASSWORDS = new Set(
  [
    "password", "password1", "password12", "password123", "passw0rd", "p@ssw0rd", "p@ssword", "letmein", "welcome", "welcome1", "welcome123", "admin", "admin123", "administrator", "changeme", "changeme123", "qwerty", "qwertyuiop", "qwerty123", "asdfghjkl", "zxcvbnm", "iloveyou", "monkey", "dragon", "football", "baseball", "sunshine", "princess", "abc123", "trustno1", "master", "shadow", "superman", "batman", "michael", "jordan", "starwars", "whatever", "freedom", "login", "hello", "secret", "test", "test123", "testtest", "guest", "default", "letmein123", "1q2w3e4r", "1qaz2wsx", "zaq12wsx", "passpass", "summer", "winter", "spring", "autumn", "google", "computer", "internet", "cheese", "qazwsx",
  ].map((p) => p.replace(/[^a-z0-9]/g, "")),
);

const OBVIOUS_STEMS = ["password", "qwerty", "letmein", "welcome", "changeme", "accuqual", "iloveyou", "admin123", "abc123"];

/** Lowercase, letters and digits only — so "P@ssw0rd!" and "password" compare the same after the usual look-alike swaps. */
function normalize(password: string): string {
  return password
    .toLowerCase()
    .replace(/@/g, "a")
    .replace(/\$/g, "s")
    .replace(/0/g, "o")
    .replace(/[^a-z0-9]/g, "");
}

function isSequential(password: string): boolean {
  const p = password.toLowerCase();
  if (p.length < PASSWORD_MIN_LENGTH) return false;
  let run = 1;
  for (let i = 1; i < p.length; i++) {
    const step = p.charCodeAt(i) - p.charCodeAt(i - 1);
    run = step === 1 || step === -1 ? run + 1 : 1;
    if (run >= p.length - 1) return true; // "abcdefghijkl", "987654321098"
  }
  return false;
}

/** Offline rules. Returns a human-readable reason a password is unacceptable, or null when it passes. */
export function passwordProblem(password: string, context: { email?: string; name?: string } = {}): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (password.length > PASSWORD_MAX_LENGTH) return `Password must be at most ${PASSWORD_MAX_LENGTH} characters.`;
  if (new Set(password).size < 4) return "Password is too repetitive — use a mix of different characters.";
  if (isSequential(password)) return "Password is a simple sequence — choose something less predictable.";

  const flat = normalize(password);
  const flatNoDigits = flat.replace(/[0-9]+$/, "");
  if (COMMON_PASSWORDS.has(flat) || COMMON_PASSWORDS.has(flatNoDigits)) return "That password is on the list of the most commonly used passwords.";
  if (OBVIOUS_STEMS.some((stem) => flatNoDigits === stem || flatNoDigits.replace(/o/g, "0") === stem)) return "That password is too easy to guess.";

  const localPart = context.email?.split("@")[0]?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (localPart && localPart.length >= 4 && flat.includes(localPart)) return "Password must not contain your email address.";
  return null;
}

/**
 * Zod rule for request bodies. Deliberately only a presence/size bound: the real rules (length, common passwords, email, breach lookup) run in assertPasswordAcceptable inside the handler, because a Zod failure reaches the client as a bare "Request failed validation" while assertPasswordAcceptable can say WHY the password was refused.
 */
export const passwordSchema = z.string().min(1).max(PASSWORD_MAX_LENGTH);

function breachCheckEnabled(): boolean {
  if (env.PASSWORD_BREACH_CHECK) return env.PASSWORD_BREACH_CHECK === "true";
  return env.NODE_ENV !== "test";
}

/** How many times the password appears in known breaches (0 when clean OR when the lookup could not be made — it fails open on purpose). */
export async function breachCount(password: string): Promise<number> {
  const sha1 = createHash("sha1").update(password).digest("hex").toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);
  try {
    const res = await fetch(`https://api.pwnedpasswords.com/range/${prefix}`, {
      headers: { "Add-Padding": "true" },
      signal: AbortSignal.timeout(2000),
    });
    if (!res.ok) return 0;
    for (const line of (await res.text()).split("\n")) {
      const [hashSuffix, count] = line.trim().split(":");
      if (hashSuffix === suffix) return Number(count) || 0;
    }
    return 0;
  } catch (err) {
    logger.warn("Password breach lookup unavailable — allowing the password on the offline rules alone.", { err: String(err) });
    return 0;
  }
}

/** Full server-side check used wherever a password is chosen (register, reset, admin-created users). Throws a 400 with the reason. */
export async function assertPasswordAcceptable(password: string, context: { email?: string; name?: string } = {}): Promise<void> {
  const problem = passwordProblem(password, context);
  if (problem) throw AppError.badRequest(problem);
  if (breachCheckEnabled() && (await breachCount(password)) > 0) {
    throw AppError.badRequest("That password has appeared in a known data breach. Please choose a different one.");
  }
}
