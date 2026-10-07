import { and, eq, lte } from "drizzle-orm";
import { db, pool } from "../../db/index.js";
import { reportSchedules } from "../../drizzle/schema/reporting.js";
import { company } from "../../drizzle/schema/company.js";
import { logger } from "../../utils/logger.js";
import { deliverReportToEach, overallDeliveryStatus } from "./reportDelivery.js";
import { buildReportEmail, REPORT_TYPE_LABELS, type ReportType } from "./reporting.templates.js";

/**
 * Phase 6 scheduled reports — this app has no background job/cron
 * infrastructure anywhere (confirmed: Phase 4's usage-limit check computes
 * "this month's usage" live rather than needing a reset job; Phase 1's
 * retry-failed-notifications is an explicit admin-triggered endpoint, not a
 * cron, per that phase's own "no background scheduler, explicit trigger
 * only" convention). Building a real distributed job queue for this one
 * feature would be a disproportionate new piece of infrastructure, so this
 * is the smallest real thing that actually works for how this app is
 * deployed today (one long-lived Render web service process, not a
 * horizontally-scaled fleet — see DEPLOY.md/render.yaml): an in-process
 * interval that polls `report_schedules` for rows whose `next_run_at` has
 * passed. This is a real, working scheduler for that deployment shape, not
 * a stand-in. Full-System Audit finding M5: if this app ever does move to
 * multiple API instances, pollDueSchedules() below now guards its own poll
 * cycle with a real Postgres advisory lock (pg_try_advisory_lock) so two
 * instances can't both pick up and send the same due schedule — still not
 * a substitute for a real distributed cron/queue (there's no retry/backoff
 * across instances, no leader election), just the one specific race this
 * scheduler could otherwise hit closed.
 */
const POLL_INTERVAL_MS = 60 * 1000;
let pollHandle: ReturnType<typeof setInterval> | null = null;

export function computeNextRunAt(frequency: "daily" | "weekly" | "monthly", from: Date = new Date()): Date {
  const next = new Date(from);
  if (frequency === "daily") next.setDate(next.getDate() + 1);
  else if (frequency === "weekly") next.setDate(next.getDate() + 7);
  else next.setMonth(next.getMonth() + 1);
  return next;
}

/** Runs one schedule immediately regardless of nextRunAt — shared by the poll loop and the "Send Now" endpoint, so both paths update the same lastRunAt/lastRunStatus fields the health-indicators UI reads. `actorId` is the person who clicked Send Now; a poll uses the schedule's creator. */
export async function runReportSchedule(scheduleId: number, actorId?: number): Promise<void> {
  const [schedule] = await db.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId));
  if (!schedule) return;

  const [co] = await db.select().from(company);
  const companyName = co?.name ?? "AccuQual";

  try {
    const { subject, body } = await buildReportEmail(db, schedule.reportType as ReportType, companyName);
    const reportName = REPORT_TYPE_LABELS[schedule.reportType as ReportType] ?? schedule.reportType;
    const deliveries = await deliverReportToEach(db, {
      recipients: schedule.recipients,
      subject,
      body,
      entityType: "ReportSchedule",
      entityId: schedule.id,
      reportName,
      performedBy: actorId ?? schedule.createdBy ?? undefined,
    });
    // "sent" only if every recipient actually delivered — a mixed batch is
    // reported as the least-successful outcome, not glossed over as "sent".
    const overallStatus = overallDeliveryStatus(deliveries);

    await db
      .update(reportSchedules)
      .set({ lastRunAt: new Date(), lastRunStatus: overallStatus, lastError: deliveries.length === 0 ? "No recipients." : null, nextRunAt: computeNextRunAt(schedule.frequency as "daily" | "weekly" | "monthly") })
      .where(eq(reportSchedules.id, schedule.id));
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report generation failed.";
    logger.error("Scheduled report failed", { scheduleId, err });
    await db
      .update(reportSchedules)
      .set({ lastRunAt: new Date(), lastRunStatus: "error", lastError: message, nextRunAt: computeNextRunAt(schedule.frequency as "daily" | "weekly" | "monthly") })
      .where(eq(reportSchedules.id, schedule.id));
  }
}

// Full-System Audit finding M5: this function's own header comment already
// flagged "two instances would both try to run the same due schedule" as a
// real gap for the day this app moves off one long-lived process. A
// Postgres advisory lock closes exactly that gap with no new
// infrastructure (no Redis, no queue) — any arbitrary bigint works as the
// key as long as it's unique across this app's advisory-lock usage, which
// today is only this one call site. Session-scoped (not the _xact variant):
// the lock must stay held across this function's several separate
// db.select/update calls below, not just one transaction.
const REPORTING_SCHEDULER_LOCK_KEY = 8_675_309_001;

async function pollDueSchedules(): Promise<void> {
  const client = await pool.connect();
  try {
    const { rows } = await client.query<{ pg_try_advisory_lock: boolean }>("SELECT pg_try_advisory_lock($1)", [REPORTING_SCHEDULER_LOCK_KEY]);
    if (!rows[0]?.pg_try_advisory_lock) {
      // Another instance is already running this poll cycle — skip, don't
      // wait. Same digest content/schedule either way: this only prevents
      // the SAME due schedule being sent twice, never delays a real send.
      return;
    }

    try {
      const due = await db.select({ id: reportSchedules.id }).from(reportSchedules).where(and(eq(reportSchedules.enabled, true), lte(reportSchedules.nextRunAt, new Date())));
      for (const row of due) await runReportSchedule(row.id);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [REPORTING_SCHEDULER_LOCK_KEY]);
    }
  } catch (err) {
    logger.error("Reporting scheduler poll failed", { err });
  } finally {
    client.release();
  }
}

/** Called once from server startup (see app.ts/server bootstrap) — a no-op if called twice. Never runs during tests (vitest never calls this). */
export function startReportingScheduler(): void {
  if (pollHandle) return;
  pollHandle = setInterval(() => void pollDueSchedules(), POLL_INTERVAL_MS);
}

export function stopReportingScheduler(): void {
  if (pollHandle) clearInterval(pollHandle);
  pollHandle = null;
}
