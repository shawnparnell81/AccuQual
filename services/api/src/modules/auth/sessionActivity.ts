import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { refreshTokens } from "../../drizzle/schema/refreshTokens.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";

/** How often a live request rewrites the session's last-activity stamp. The idle window is much longer than this. */
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

export function idleWindowMs(): number {
  return env.SESSION_IDLE_TIMEOUT_MINUTES * 60_000;
}

export function sessionIsIdle(lastActivityAt: Date, now = Date.now()): boolean {
  return now - lastActivityAt.getTime() > idleWindowMs();
}

/**
 * Records that this sign-in was just used. Skips the write when the stamp
 * is already recent, so a busy page does not update the row on every call.
 * A failure here does not fail the request; the next refresh still sees the
 * previous stamp.
 */
export async function touchSessionActivity(jti: string | undefined): Promise<void> {
  if (!jti) return;
  try {
    const staleBefore = new Date(Date.now() - ACTIVITY_WRITE_INTERVAL_MS);
    await db
      .update(refreshTokens)
      .set({ lastActivityAt: new Date() })
      .where(and(eq(refreshTokens.jti, jti), isNull(refreshTokens.revokedAt), isNull(refreshTokens.usedAt), lt(refreshTokens.lastActivityAt, staleBefore)));
  } catch (err) {
    logger.warn("Couldn't record session activity", { err: String(err) });
  }
}
