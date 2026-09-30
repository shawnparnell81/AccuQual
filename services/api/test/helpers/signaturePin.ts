import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/index.js";
import { users } from "../../src/drizzle/schema/users.js";

/** Shared test PIN. Cost 4 keeps the suite fast; production hashes use cost 10. */
export const TEST_PIN = "2468";

export async function setTestPin(userId: number): Promise<void> {
  await db
    .update(users)
    .set({ pinHash: await bcrypt.hash(TEST_PIN, 4), pinSetAt: new Date(), pinFailedCount: 0, pinLockedUntil: null })
    .where(eq(users.id, userId));
}
