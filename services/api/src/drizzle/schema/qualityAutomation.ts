import { pgTable, serial, text, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * One row per reminder we already sent, so the six-hour sweep does not mail
 * the same due-soon / overdue / escalation / digest notice again. `bucket`
 * is the episode: a due date, the day a record went quiet, or the calendar
 * day of a digest.
 */
export const qualityReminderLog = pgTable(
  "quality_reminder_log",
  {
    id: serial("id").primaryKey(),
    kind: text("kind").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: integer("entity_id").notNull(),
    recipient: text("recipient").notNull(),
    bucket: text("bucket").notNull(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    dedupe: uniqueIndex("quality_reminder_log_dedupe").on(table.kind, table.entityType, table.entityId, table.recipient, table.bucket),
  }),
);

export type QualityReminderLog = typeof qualityReminderLog.$inferSelect;
