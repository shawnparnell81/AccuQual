import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * Shared by any module, not inventory-specific. There is no real email
 * service configured yet (no Email Routing settings exist anywhere in
 * AccuQual) — status is "logged_only" until a real transport is plugged
 * into notification.service.ts, at which point "sent"/"failed" become
 * real outcomes without any caller needing to change.
 */
export const notificationLog = pgTable("notification_log", {
  id: serial("id").primaryKey(),
  tenantId: integer("tenant_id").references(() => tenants.id).notNull(),
  channel: text("channel").notNull().default("email"),
  recipient: text("recipient").notNull(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  status: text("status").notNull().default("logged_only"), // sent, failed, logged_only
  relatedEntityType: text("related_entity_type"),
  relatedEntityId: integer("related_entity_id"),
  createdAt: timestamp("created_at").defaultNow(),
  // Read state for the in-app notification bell (see notification.me.routes.ts) — null means unread. This log was
  // originally write-only (an audit trail of outbound emails); this is the first thing that ever reads it back for
  // display, so it's scoped hard to `recipient = the caller's own email` — never a second person's rows.
  readAt: timestamp("read_at"),
});

export type NotificationLogEntry = typeof notificationLog.$inferSelect;
