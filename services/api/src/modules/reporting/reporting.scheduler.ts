import { and, eq, lte } from "drizzle-orm";
import { db } from "../../db/index.js";
import { reportSchedules } from "../../drizzle/schema/reporting.js";
import { tenants } from "../../drizzle/schema/tenants.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { sendEmail } from "../notifications/notification.service.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { logger } from "../../utils/logger.js";
import { buildReportEmail, type ReportType } from "./reporting.templates.js";

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
 * a stand-in — it is NOT a substitute for a real cron/queue if this app
 * ever moves to multiple API instances (two instances would both try to
 * run the same due schedule; there's no distributed lock here).
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

/** Runs one schedule immediately regardless of nextRunAt — shared by the poll loop and the "Send Now" endpoint, so both paths update the same lastRunAt/lastRunStatus fields the health-indicators UI reads. */
export async function runReportSchedule(scheduleId: number): Promise<void> {
  const [schedule] = await db.select().from(reportSchedules).where(eq(reportSchedules.id, scheduleId));
  if (!schedule) return;

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, schedule.tenantId));
  const tenantName = tenant?.name ?? `Tenant #${schedule.tenantId}`;

  try {
    const { subject, body } = await buildReportEmail(db, schedule.tenantId, schedule.reportType as ReportType, tenantName);

    const statuses = await Promise.all(schedule.recipients.map((to) => sendEmail({ to, subject, body })));
    for (const [i, status] of statuses.entries()) {
      await db.insert(notificationLog).values({
        tenantId: schedule.tenantId,
        channel: "email",
        recipient: schedule.recipients[i]!,
        subject,
        body,
        status,
        relatedEntityType: "ReportSchedule",
        relatedEntityId: schedule.id,
      });
    }
    // "sent" only if every recipient actually delivered — a mixed batch is
    // reported as the least-successful outcome, not glossed over as "sent".
    const overallStatus = statuses.every((s) => s === "sent") ? "sent" : statuses.some((s) => s === "failed") ? "failed" : "logged_only";

    await db
      .update(reportSchedules)
      .set({ lastRunAt: new Date(), lastRunStatus: overallStatus, lastError: null, nextRunAt: computeNextRunAt(schedule.frequency as "daily" | "weekly" | "monthly") })
      .where(eq(reportSchedules.id, schedule.id));

    await recordAuditTrail(db, {
      tenantId: schedule.tenantId,
      entityType: "ReportSchedule",
      entityId: schedule.id,
      action: "update",
      changes: { action: "run", reportType: schedule.reportType, recipients: schedule.recipients, status: overallStatus },
      performedBy: schedule.createdBy ?? undefined,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Report generation failed.";
    logger.error("Scheduled report failed", { scheduleId, err });
    await db
      .update(reportSchedules)
      .set({ lastRunAt: new Date(), lastRunStatus: "error", lastError: message, nextRunAt: computeNextRunAt(schedule.frequency as "daily" | "weekly" | "monthly") })
      .where(eq(reportSchedules.id, schedule.id));
  }
}

async function pollDueSchedules(): Promise<void> {
  try {
    const due = await db.select({ id: reportSchedules.id }).from(reportSchedules).where(and(eq(reportSchedules.enabled, true), lte(reportSchedules.nextRunAt, new Date())));
    for (const row of due) await runReportSchedule(row.id);
  } catch (err) {
    logger.error("Reporting scheduler poll failed", { err });
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
