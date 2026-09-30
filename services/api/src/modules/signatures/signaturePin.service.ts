import type { Request } from "express";
import { eq } from "drizzle-orm";
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
  pinLockActive,
  pinMatches,
  registerPinFailure,
  signedOnDate,
} from "./signaturePin.js";

const PIN_LOCK_SECONDS = 15 * 60;

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

function lockMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many incorrect PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}

/** Checks the PIN. A wrong PIN does not produce a stamp. Failures are stored outside the request transaction so a rollback cannot erase them. */
export async function verifySignaturePin(userId: number, pin: string): Promise<{ displayName: string }> {
  if (!isFourDigitPin(pin)) throw AppError.badRequest("Enter a 4-digit PIN.");
  const user = await loadUser(userId);
  if (!user) throw AppError.unauthorized("Session is no longer valid");
  if (!user.pinHash) throw AppError.forbidden("Set a 4-digit signature PIN before signing.");

  const now = new Date();
  const lock = pinLockActive({ count: user.pinFailedCount, lockedUntil: user.pinLockedUntil }, now);
  if (lock.locked) throw new AppError(lockMessage(lock.retryAfterSeconds), 429);

  if (!(await pinMatches(pin, user.pinHash))) {
    const next = registerPinFailure({ count: user.pinFailedCount, lockedUntil: user.pinLockedUntil }, now);
    await db
      .update(users)
      .set({ pinFailedCount: next.count, pinLockedUntil: next.lockedUntil, updatedAt: new Date() })
      .where(eq(users.id, userId));
    if (next.justLocked) throw new AppError(lockMessage(PIN_LOCK_SECONDS), 429);
    throw AppError.unauthorized("That PIN is not correct.");
  }

  await db.update(users).set({ pinFailedCount: 0, pinLockedUntil: null }).where(eq(users.id, userId));
  return { displayName: formatUserLabel(user, user.id) };
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
