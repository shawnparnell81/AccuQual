import bcrypt from "bcryptjs";
import { safeTimeZone, calendarDay } from "../quality-automation/logic.js";

/** Field names a person signs. A generic save cannot invent or replace these. */
export const SIGNATURE_FIELD_KEYS = new Set([
  "signature",
  "authorizedSignature",
  "approvalSignature",
  "signatureTitle",
  "operatorSignature",
  "inspectorSignature",
  "supplierRepSignature",
  "qualityEngineerSignature",
  "qaLeadSignature",
  "preparedSignature",
  "approvedSignature",
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

export const PIN_MAX_ATTEMPTS = 5;
export const PIN_LOCK_MS = 15 * 60 * 1000;

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

export function pinLockActive(state: PinAttemptState, now: Date): { locked: true; retryAfterSeconds: number } | { locked: false } {
  if (state.lockedUntil && state.lockedUntil.getTime() > now.getTime()) {
    const retryAfterSeconds = Math.max(1, Math.ceil((state.lockedUntil.getTime() - now.getTime()) / 1000));
    return { locked: true, retryAfterSeconds };
  }
  return { locked: false };
}

/** Counts a wrong PIN. The fifth failure in a row locks the PIN for 15 minutes. */
export function registerPinFailure(state: PinAttemptState, now: Date): PinAttemptState & { justLocked: boolean } {
  const expired = state.lockedUntil != null && state.lockedUntil.getTime() <= now.getTime();
  const count = (expired ? 0 : state.count) + 1;
  if (count >= PIN_MAX_ATTEMPTS) {
    return { count: 0, lockedUntil: new Date(now.getTime() + PIN_LOCK_MS), justLocked: true };
  }
  return { count, lockedUntil: null, justLocked: false };
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
