import { pgTable, serial, text, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Admin login history. One row per sign-in, failed attempt, sign-out, or a
 * refresh that starts a new session. Ordinary access-token refresh is not
 * stored. Rows are kept; nothing in the app deletes them before a year.
 * Passwords and tokens are never written here.
 *
 * The older SignIn audit trail still stores only a hash of the address and
 * browser. This table is the one the Login History page reads, because that
 * page has to show the address, the place, and the device.
 */
export const loginEvents = pgTable(
  "login_events",
  {
    id: serial("id").primaryKey(),
    /** The installation's company row. Admins only see rows for that company. */
    companyId: integer("company_id"),
    userId: integer("user_id").references(() => users.id, { onDelete: "set null" }),
    email: text("email"),
    userName: text("user_name"),
    /** UTC. timestamptz so the value does not depend on the database session zone. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
    /** signed_in | sign_in_failed | signed_out */
    eventType: text("event_type").notNull(),
    success: boolean("success").notNull(),
    reason: text("reason"),
    /** password | mfa | trusted_device | sso | session | browser | session_refresh */
    method: text("method"),
    ipAddress: text("ip_address"),
    locationCity: text("location_city"),
    locationRegion: text("location_region"),
    locationCountry: text("location_country"),
    userAgent: text("user_agent"),
    browser: text("browser"),
    browserVersion: text("browser_version"),
    os: text("os"),
    /** desktop | mobile | tablet */
    deviceType: text("device_type"),
  },
  (table) => [index("login_events_company_occurred_idx").on(table.companyId, table.occurredAt)],
);

export type LoginEvent = typeof loginEvents.$inferSelect;
