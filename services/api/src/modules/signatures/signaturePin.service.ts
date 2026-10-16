import type { Request } from "express";
import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../../db/index.js";
import { users } from "../../drizzle/schema/users.js";
import { company } from "../../drizzle/schema/company.js";
import { AppError } from "../../utils/appError.js";
import { logger } from "../../utils/logger.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { formatUserLabel } from "../users/userDisplay.js";
import { safeTimeZone } from "../quality-automation/logic.js";
import {
  formatSignatureStamp,
  hashPin,
  isFourDigitPin,
  PIN_MAX_ATTEMPTS,
  PinRepeatGuard,
  pinLockActive,
  pinMatches,
  signedOnDate,
} from "./signaturePin.js";

const repeatGuard = new PinRepeatGuard();
/** Wrong-PIN digests per user, so a correct PIN clears that person's repeat memory. */
const userKeys = new Map<number, Set<string>>();

async function loadUser(userId: number) {
  const [user] = await db
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isActive: users.isActive,
      pinHash: users.pinHash,
      pinFailedCount: users.pinFailedCount,
      pinLockedUntil: users.pinLockedUntil,
    })
    .from(users)
    .where(eq(users.id, userId));
  return user;
}

export const PIN_LOCKED_MESSAGE = `Your signature PIN is locked after ${PIN_MAX_ATTEMPTS} incorrect tries. Ask an administrator to unlock it in Admin → Users & Roles.`;

function wrongPinMessage(count: number): string {
  const left = PIN_MAX_ATTEMPTS - count;
  return `That PIN is not correct. ${left} ${left === 1 ? "try" : "tries"} left before your PIN locks.`;
}

async function auditPinLocked(userId: number, who: string): Promise<void> {
  const when = new Date();
  await recordAuditTrail(db, {
    entityType: "User",
    entityId: userId,
    action: "status_change",
    changes: {
      action: "signature_pin_locked",
      who,
      what: "Signature PIN",
      when: when.toISOString(),
      description: `Signature PIN locked after ${PIN_MAX_ATTEMPTS} incorrect PINs in a row. An administrator must unlock it.`,
    },
    performedBy: userId,
  }).catch((err) => logger.error("Failed to audit a signature PIN lock", { userId, err }));
}

/**
 * Checks the PIN. A wrong PIN does not produce a stamp. Each wrong PIN counts once: the same wrong PIN sent twice within a
 * few seconds (double click, Enter twice, a page that checks twice) is one attempt, and overlapping identical checks share
 * one result. The fifth wrong PIN in a row locks signing until an administrator unlocks it; a correct PIN resets the count.
 * Failures are stored outside the request transaction so a rollback cannot erase them.
 */
export async function verifySignaturePin(userId: number, pin: string): Promise<{ displayName: string }> {
  if (!isFourDigitPin(pin)) throw AppError.badRequest("Enter a 4-digit PIN.");
  const key = repeatGuard.key(userId, pin);
  return repeatGuard.once(key, () => checkPin(userId, pin, key));
}

async function checkPin(userId: number, pin: string, key: string): Promise<{ displayName: string }> {
  const user = await loadUser(userId);
  if (!user) throw AppError.unauthorized("Session is no longer valid");
  if (!user.pinHash) throw AppError.forbidden("Set a 4-digit signature PIN before signing.");

  const now = new Date();
  if (pinLockActive({ count: user.pinFailedCount, lockedUntil: user.pinLockedUntil }, now)) throw new AppError(PIN_LOCKED_MESSAGE, 423, { code: "pin_locked" });

  if (!(await pinMatches(pin, user.pinHash))) {
    if (repeatGuard.isRepeat(key, now.getTime())) throw new AppError(wrongPinMessage(user.pinFailedCount), 403, { code: "pin_incorrect" });
    repeatGuard.remember(key, now.getTime());
    let keys = userKeys.get(userId);
    if (!keys) userKeys.set(userId, (keys = new Set()));
    keys.add(key);
    const [row] = await db
      .update(users)
      .set({ pinFailedCount: sql`${users.pinFailedCount} + 1`, updatedAt: new Date() })
      .where(and(eq(users.id, userId), lt(users.pinFailedCount, PIN_MAX_ATTEMPTS)))
      .returning({ count: users.pinFailedCount });
    if (!row) throw new AppError(PIN_LOCKED_MESSAGE, 423, { code: "pin_locked" });
    const count = row.count;
    if (count >= PIN_MAX_ATTEMPTS) {
      await auditPinLocked(userId, formatUserLabel(user, user.id));
      throw new AppError(PIN_LOCKED_MESSAGE, 423, { code: "pin_locked" });
    }
    throw new AppError(wrongPinMessage(count), 403, { code: "pin_incorrect" });
  }

  const keys = userKeys.get(userId);
  if (keys) {
    repeatGuard.forgetUser([...keys]);
    userKeys.delete(userId);
  }
  if (user.pinFailedCount !== 0 || user.pinLockedUntil) {
    await db.update(users).set({ pinFailedCount: 0, pinLockedUntil: null }).where(eq(users.id, userId));
  }
  return { displayName: formatUserLabel(user, user.id) };
}

/** True when this person's signature PIN is locked. */
export function isPinLocked(row: { pinFailedCount: number; pinLockedUntil: Date | null }): boolean {
  return pinLockActive({ count: row.pinFailedCount, lockedUntil: row.pinLockedUntil }, new Date());
}

export async function setSignaturePin(userId: number, pin: string, confirmPin: string): Promise<void> {
  if (!isFourDigitPin(pin) || pin !== confirmPin) throw AppError.badRequest("Enter the same 4-digit PIN twice.");
  const user = await loadUser(userId);
  if (!user) throw AppError.unauthorized("Session is no longer valid");
  if (user.pinHash) throw new AppError("A signature PIN is already set. Change it in Settings.", 409);
  await db
    .update(users)
    .set({ pinHash: await hashPin(pin), pinSetAt: new Date(), pinFailedCount: 0, pinLockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await recordAuditTrail(db, {
    entityType: "User",
    entityId: userId,
    action: "status_change",
    changes: { action: "signature_pin_set" },
    performedBy: userId,
  }).catch((err) => logger.error("Failed to audit signature PIN setup", { userId, err }));
}

export async function changeSignaturePin(userId: number, currentPin: string, pin: string, confirmPin: string): Promise<void> {
  if (!isFourDigitPin(pin) || pin !== confirmPin) throw AppError.badRequest("Enter the same 4-digit PIN twice.");
  if (pin === currentPin) throw AppError.badRequest("Choose a different PIN.");
  await verifySignaturePin(userId, currentPin);
  await db
    .update(users)
    .set({ pinHash: await hashPin(pin), pinSetAt: new Date(), pinFailedCount: 0, pinLockedUntil: null, updatedAt: new Date() })
    .where(eq(users.id, userId));
  await recordAuditTrail(db, {
    entityType: "User",
    entityId: userId,
    action: "status_change",
    changes: { action: "signature_pin_changed" },
    performedBy: userId,
  }).catch((err) => logger.error("Failed to audit a signature PIN change", { userId, err }));
}

export interface SignatureStamp {
  stamp: string;
  signedAt: Date;
  signedOn: string;
  displayName: string;
  timeZone: string;
}

/**
 * Confirms the PIN and the certification checkbox, then builds the stamp.
 * The caller writes `stamp` into the signature field. The audit row records
 * who signed, which field, when, and the certification text.
 */
export async function requireSignatureStamp(
  req: Request,
  input: { pin: unknown; certified: unknown; entityType: string; entityId: number; field: string; description: string },
): Promise<SignatureStamp> {
  if (input.certified !== true) throw AppError.badRequest("Check the certification box before signing.");
  if (typeof input.pin !== "string") throw AppError.badRequest("Enter a 4-digit PIN.");
  const { displayName } = await verifySignaturePin(req.user!.id, input.pin);

  const [co] = await req.db!.select({ profile: company.profile }).from(company).limit(1);
  const timeZone = safeTimeZone(co?.profile?.timezone);
  const signedAt = new Date();
  const stamp = formatSignatureStamp(displayName, signedAt, timeZone);
  const description = input.description.trim().slice(0, 400) || "Signed this record.";

  await recordAuditTrail(req.db!, {
    entityType: input.entityType,
    entityId: input.entityId,
    action: "update",
    changes: {
      action: "signature",
      who: displayName,
      what: input.field,
      when: signedAt.toISOString(),
      description,
      timeZone,
      stamp,
    },
    performedBy: req.user?.id,
  });

  return { stamp, signedAt, signedOn: signedOnDate(signedAt, timeZone), displayName, timeZone };
}
