import { pgTable, serial, text, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { users } from "./users.js";

/**
 * Phase 6 Reporting & Analytics Hub — one row per recurring report a tenant
 * wants emailed on a schedule. `nextRunAt` is a real stored timestamp (not
 * re-derived from a cron expression on every check) so the scheduler's own
 * poll loop (reporting/scheduler.ts) is a cheap `WHERE next_run_at <= now()`
 * — computing "is a weekly report due" from scratch on every tick across
 * every tenant would be needless work for what's really just "add 1 day /
 * 7 days / 1 month to a timestamp" arithmetic done once, at save time and
 * again after each run.
 */
export const reportSchedules = pgTable("report_schedules", {
  id: serial("id").primaryKey(),
  reportType: text("report_type").notNull(), // ncr_summary, capa_summary, supplier_scorecard, warranty_summary, receiving_summary
  frequency: text("frequency").notNull(), // daily, weekly, monthly
  recipients: jsonb("recipients").$type<string[]>().notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastRunAt: timestamp("last_run_at"),
  lastRunStatus: text("last_run_status"), // sent, logged_only, failed, error
  lastError: text("last_error"),
  nextRunAt: timestamp("next_run_at").notNull(),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at"),
});

export type ReportSchedule = typeof reportSchedules.$inferSelect;
