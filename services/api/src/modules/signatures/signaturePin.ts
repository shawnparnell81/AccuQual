import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { safeTimeZone, calendarDay } from "../quality-automation/logic.js";

/** Field names a person signs. A generic save cannot invent or replace these. */
export const SIGNATURE_FIELD_KEYS = new Set([
  "signature",
  "authorizedSignature",
  "furtherSignature",
  "approvalSignature",
  "signatureTitle",
  "operatorSignature",
  "inspectorSignature",
  "supplierRepSignature",
  "qualityEngineerSignature",
  "qaLeadSignature",
  "preparedSignature",
  "approvedSignature",
  "testedSignature",
  "managerSignature",
  "engineeringSignoffSignature",
  "qualitySignoffSignature",
  "manufacturingSignoffSignature",
  "purchasingSignoffSignature",
  "salesSignoffSignature",
  "leadAuditorSignature",
  "managementSignature",
  "auditeeSignature1",
  "auditeeSignature2",
  "auditeeSignature3",
  "auditeeSignature4",
]);

const DATE_SIBLING: Record<string, string> = {
  signature: "date",
  authorizedSignature: "date",
  approvalSignature: "approvalDate",
  signatureTitle: "signatureDate",
};

export { PIN_SETUP_PATHS, missingPinBlocks } from "./signaturePinGate.js";

/** Consecutive wrong PINs before the PIN locks (NIST SP 800-63B 5.2.2 rate limiting). The lock stays until an administrator unlocks it. */
export const PIN_MAX_ATTEMPTS = 5;
/** A repeat of the same wrong PIN inside this window (a double click, Enter pressed twice, two checks in one save) counts once. */
export const PIN_REPEAT_WINDOW_MS = 10_000;

export function isFourDigitPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function hashPin(pin: string): Promise<string> {
  return bcrypt.hash(pin, 10);
}

/** True only when the PIN matches the stored hash. A missing hash never matches. */
export async function pinMatches(pin: string, pinHash: string | null | undefined): Promise<boolean> {
  if (!pinHash || !isFourDigitPin(pin)) return false;
  return bcrypt.compare(pin, pinHash);
}

export interface PinAttemptState {
  count: number;
  lockedUntil: Date | null;
}

/** Locked when the person has reached the limit of wrong PINs in a row. A timed lock from before this rule still counts until it runs out. */
export function pinLockActive(state: PinAttemptState, now: Date): boolean {
  if (state.count >= PIN_MAX_ATTEMPTS) return true;
  return state.lockedUntil != null && state.lockedUntil.getTime() > now.getTime();
}

/**
 * Remembers recent wrong PINs (as a salted digest, never the PIN) so the same wrong entry repeated within a few
 * seconds is one attempt, and two checks running at the same moment share one result.
 */
export class PinRepeatGuard {
  private readonly recent = new Map<string, number>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  private readonly salt = randomBytes(16).toString("hex");

  key(userId: number, pin: string): string {
    return createHash("sha256").update(`${this.salt}:${userId}:${pin}`).digest("hex");
  }

  isRepeat(key: string, now: number): boolean {
    const at = this.recent.get(key);
    return at != null && now - at < PIN_REPEAT_WINDOW_MS;
  }

  remember(key: string, now: number): void {
    this.recent.set(key, now);
    if (this.recent.size > 5000) {
      for (const [k, at] of this.recent) if (now - at >= PIN_REPEAT_WINDOW_MS) this.recent.delete(k);
    }
  }

  forgetUser(keys: string[]): void {
    for (const k of keys) this.recent.delete(k);
  }

  /** Runs `work` once for identical checks that overlap in time. */
  async once<T>(key: string, work: () => Promise<T>): Promise<T> {
    const running = this.inFlight.get(key) as Promise<T> | undefined;
    if (running) return running;
    const p = work().finally(() => this.inFlight.delete(key));
    this.inFlight.set(key, p);
    return p;
  }
}

/** Display name plus the date and time in the company timezone. */
export function formatSignatureStamp(displayName: string, signedAt: Date, timeZone: string): string {
  const zone = safeTimeZone(timeZone);
  const when = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(signedAt);
  return `${displayName} — ${when}`;
}

export function signedOnDate(signedAt: Date, timeZone: string): string {
  return calendarDay(signedAt, safeTimeZone(timeZone));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Keeps signature text that the server already stored. A save cannot type a
 * name into a signature field or wipe one that was stamped.
 */
export function retainSignatureValues<T>(previous: T, incoming: T): T {
  return mergeValues(previous, incoming) as T;
}

function mergeValues(previous: unknown, incoming: unknown): unknown {
  if (Array.isArray(incoming) || Array.isArray(previous)) {
    const prevArr = Array.isArray(previous) ? previous : [];
    const nextArr = Array.isArray(incoming) ? incoming : [];
    const length = Math.max(prevArr.length, nextArr.length);
    return Array.from({ length }, (_, index) => mergeValues(prevArr[index], nextArr[index]));
  }
  if (isRecord(incoming) || isRecord(previous)) {
    const prev = isRecord(previous) ? previous : {};
    const next = isRecord(incoming) ? incoming : {};
    const out: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (SIGNATURE_FIELD_KEYS.has(key)) {
        const kept = prev[key];
        if (typeof kept === "string" && kept.trim() !== "") out[key] = kept;
        else if (key in next) out[key] = "";
        else if (kept !== undefined) out[key] = kept;
        continue;
      }
      const merged = key in next ? mergeValues(prev[key], next[key]) : prev[key];
      if (merged !== undefined) out[key] = merged;
    }
    return out;
  }
  return incoming === undefined ? previous : incoming;
}

/** Writes a server-built stamp into a signature field. Refuses any other field. */
export function writeSignatureValue(data: Record<string, unknown>, path: string, stamp: string, signedOn: string): Record<string, unknown> {
  const parts = path.split(".");
  if (parts.length < 1 || parts.length > 4 || parts.some((part) => !/^(?:[A-Za-z][A-Za-z0-9]*|\d+)$/.test(part))) {
    throw new Error("That signature field is not recognized.");
  }
  const leaf = parts[parts.length - 1]!;
  if (!SIGNATURE_FIELD_KEYS.has(leaf)) throw new Error("That signature field is not recognized.");

  const root = structuredClone(data) as Record<string, unknown>;
  let cursor: unknown = root;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i]!;
    const index = /^\d+$/.test(part);
    const nextIsIndex = /^\d+$/.test(parts[i + 1]!);
    if (index) {
      if (!Array.isArray(cursor)) throw new Error("That signature field is not recognized.");
      const at = Number(part);
      if (at > 200) throw new Error("That signature field is not recognized.");
      if (cursor[at] == null) cursor[at] = nextIsIndex ? [] : {};
      cursor = cursor[at];
      continue;
    }
    if (!isRecord(cursor)) throw new Error("That signature field is not recognized.");
    if (cursor[part] == null) cursor[part] = nextIsIndex ? [] : {};
    cursor = cursor[part];
  }
  if (!isRecord(cursor)) throw new Error("That signature field is not recognized.");
  cursor[leaf] = stamp;
  const sibling = DATE_SIBLING[leaf];
  if (sibling && (cursor[sibling] == null || cursor[sibling] === "")) cursor[sibling] = signedOn;
  return root;
}
