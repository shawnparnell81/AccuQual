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
 * Not in rls-policies.sql's tenant_tables array, on purpose — same
 * reasoning as passwordResetTokens.ts's own comment: refresh() runs before
 * a tenant is resolved from req.tenantId (it derives the user, and through
 * it the tenant, from the token itself), so there's no tenant context to
 * scope this by and no tenantId column to scope with.
 */
export const refreshTokens = pgTable("refresh_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").references(() => users.id).notNull(),
  jti: text("jti").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  // Set the moment this token is redeemed via /auth/refresh — a second
  // redemption of the same jti after this is set is reuse, not a race
  // (the row is marked used synchronously, in the same statement that
  // reads it, before the new token is even issued).
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
