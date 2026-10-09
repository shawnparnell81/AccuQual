import { and, eq, isNull, lt } from "drizzle-orm";
import { db } from "../../db/index.js";
import { refreshTokens } from "../../drizzle/schema/refreshTokens.js";
import { logger } from "../../utils/logger.js";

/** How often a live request rewrites the session's last-activity stamp. The stamp does not decide when the sign-in ends. */
const ACTIVITY_WRITE_INTERVAL_MS = 60_000;

/**
 * Records that this sign-in was just used. Skips the write when the stamp
 * is already recent, so a busy page does not update the row on every call.
 * A failure here does not fail the request. The stamp is not an idle timeout:
 * the sign-in lasts until the company session length, measured from sign-in.
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
