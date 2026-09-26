import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * One-time backup codes for a user's authenticator app (shown once at
 * enrollment). Only a SHA-256 hash of each code is stored — the codes are
 * random and high-entropy, so a fast hash is fine, same reasoning as
 * passwordResetTokens.ts. Not and deny-all under RLS, like the
 * other auth token tables: only sign-in code on the owner connection reads it.
 */
export const mfaRecoveryCodes = pgTable("mfa_recovery_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  codeHash: text("code_hash").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type MfaRecoveryCode = typeof mfaRecoveryCodes.$inferSelect;
