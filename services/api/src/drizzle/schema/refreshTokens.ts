import { pgTable, serial, integer, text, timestamp } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Security-audit finding (medium): refresh tokens previously had no
 * rotation or reuse detection at all — a stolen refresh token stayed valid
 * for its full TTL, with only manual revocation (logout/password-reset's
 * tokenVersion bump) as a backstop. This table tracks each issued refresh
 * token by its JWT `jti` (see jwt.ts's RefreshTokenPayload), so
 * auth.service.ts's refresh() can detect a token being presented a second
 * time after it was already rotated — the signature of a stolen token being
 * replayed after the legitimate client already rotated past it — and react
 * by revoking the whole account's session (the same tokenVersion bump
 * logout() already uses), not just silently accepting it.
 *
 * Never touched through a request's `req.db`, on purpose — same
 * reasoning as passwordResetTokens.ts's own comment: refresh() runs before
 * a user is resolved (it derives the user from the token itself), so it uses
 * the plain `db` singleton. Deny-all under RLS for the app role.
 */
export const refreshTokens = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  jti: text("jti").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  // Last request that used this sign-in. It does not end the sign-in.
  // The session ends at expiresAt, which is the company session length
  // measured from sign-in. A new row starts at now.
  lastActivityAt: timestamp("last_activity_at").defaultNow().notNull(),
  // Set by the conditional update that claims this token for rotation.
  // A second presentation inside a short window is an overlapping renewal
  // (see REFRESH_REUSE_GRACE_MS in auth.service.ts). After that window, or
  // once the replacement token has itself been used, it is reuse.
  usedAt: timestamp("used_at"),
  // Set on logout/password-reset (whole-account revocation) or the moment
  // reuse is detected on this token's own family.
  revokedAt: timestamp("revoked_at"),
  // The jti of the token this one was rotated into, when used normally —
  // lets a future incident review walk the real rotation chain.
  replacedByJti: text("replaced_by_jti"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RefreshToken = typeof refreshTokens.$inferSelect;
