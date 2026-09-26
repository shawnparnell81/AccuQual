import { pgTable, serial, integer, text, timestamp, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * A browser the user has asked not to prompt for an authenticator code.
 * The cookie holds a random token; this table stores only its SHA-256 hash,
 * the same way password-reset tokens are stored. Deny-all under RLS: sign-in
 * reads it on the owner connection (there is no session yet), and the
 * signed-in settings screens use that same connection so the app role never
 * sees the hash.
 *
 * expires_at is fixed at creation (30 days). Using the device updates
 * last_used_at only — it does not move the expiry.
 */
export const trustedDevices = pgTable(
  "trusted_devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").references(() => users.id).notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    label: text("label").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    lastUsedAt: timestamp("last_used_at"),
    revokedAt: timestamp("revoked_at"),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => [index("trusted_devices_user_idx").on(table.userId)],
);

export type TrustedDevice = typeof trustedDevices.$inferSelect;
