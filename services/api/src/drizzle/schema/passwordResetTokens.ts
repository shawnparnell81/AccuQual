import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Inspection Report ONB-02/R05: there was no password-recovery path at all —
 * a locked-out user's only option was another human resetting it by hand.
 * A dedicated table (not two extra nullable columns bolted onto `users`),
 * matching how this app models "an event/request against a user" elsewhere
 * (training_assignments, supplier_scorecards, ...) rather than crowding the
 * user row with transient, security-sensitive state.
 *
 * Never touched through a request's `req.db`, on purpose — like `users`/
 * `roles`, this is only ever queried via the plain `db` singleton (see
 * auth.service.ts's own comment on why login does the same): the whole point
 * of "forgot password" is that the caller isn't signed in yet, so there is no
 * request transaction or user to work from. Deny-all under RLS for the app role.
 *
 * tokenHash, never the raw token — same principle as users.passwordHash;
 * the raw token only ever exists in the emailed link and the request that
 * redeems it, never at rest.
 */
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  tokenHash: text("token_hash").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
