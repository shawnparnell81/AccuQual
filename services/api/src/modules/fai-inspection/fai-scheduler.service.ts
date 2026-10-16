import { and, eq, gte, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { db as ownerDb, pool } from "../../db/index.js";
import { logger } from "../../utils/logger.js";
import { inspApprovedSources } from "../../drizzle/schema/faiInspection.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { notifyInApp } from "../notifications/notification.service.js";
import { recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { isSiteAdmin } from "../sites/siteAccess.js";
import { FAI_VIEW_PERMISSION, SITES_VIEW_ALL_PERMISSION } from "../roles/roleAccess.js";
import { dueStatusFor, isoToday, type DueStatus } from "./fai-due-status.js";
import { notifyDueReminder, sendMondaySummaries } from "./fai-notifications.service.js";

const ENTITY = "FAI Approved Source";

export interface DueSourceRow {
  id: number;
  partNumber: string;
  supplierFactory: string | null;
  receivingLocation: string | null;
  siteId: number | null;
  nextDueDate: string | null;
  dueStatus: DueStatus;
}

/** Every approved source that is due soon or overdue, with its computed status. */
export async function sourcesNeedingAttention(db: Db, today: string = isoToday()): Promise<DueSourceRow[]> {
  const rows = await db
    .select({
      id: inspApprovedSources.id,
      partNumber: inspApprovedSources.partNumber,
      supplierFactory: inspApprovedSources.supplierFactory,
      receivingLocation: inspApprovedSources.receivingLocation,
      siteId: inspApprovedSources.siteId,
      nextDueDate: inspApprovedSources.nextDueDate,
    })
    .from(inspApprovedSources)
    .where(eq(inspApprovedSources.status, "approved"));
  return rows
    .map((r) => ({ ...r, dueStatus: dueStatusFor(r.nextDueDate, today) }))
    .filter((r) => r.dueStatus !== null);
}

/**
 * Active users with fai.view, for a given plant. A user counts as "for that plant" if
 * their own current plant matches, or their role can see every plant (admin/owner, or
 * the sites.view_all permission) — the same rule withSiteContext uses elsewhere. A
 * source with no plant at all (siteId null) has no plant to match, so everyone with
 * fai.view is notified about it.
 */
export async function recipientsForSite(db: Db, siteId: number | null): Promise<string[]> {
  const rows = await db
    .select({ email: users.email, roleName: roles.name, currentSiteId: users.currentSiteId })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id))
    .where(and(eq(users.isActive, true), sql`${roles.permissions} @> ${JSON.stringify([FAI_VIEW_PERMISSION])}::jsonb`));
  if (siteId == null) return rows.map((r) => r.email);
  const viewAllRoles = new Set(
    (await db.select({ name: roles.name }).from(roles).where(sql`${roles.permissions} @> ${JSON.stringify([SITES_VIEW_ALL_PERMISSION])}::jsonb`)).map((r) => r.name),
  );
  return rows.filter((r) => r.currentSiteId === siteId || isSiteAdmin(r.roleName) || (r.roleName && viewAllRoles.has(r.roleName))).map((r) => r.email);
}

function subjectFor(source: DueSourceRow): string {
  const who = [source.supplierFactory, source.receivingLocation].filter(Boolean).join(" / ") || "no supplier on file";
  const when = source.nextDueDate ?? "unknown date";
  return source.dueStatus === "overdue" ? `${source.partNumber} / ${who} FAI is overdue (was due ${when})` : `${source.partNumber} / ${who} FAI due ${when}`;
}

/**
 * Already notified today? One check per (source, recipient) so a second sweep the same day is a no-op.
 * created_at is the database's own clock, so "today" is the database's date too. Comparing it with a
 * UTC midnight sent from Node sent the same notice twice every evening on a database not set to UTC.
 */
async function alreadyNotifiedToday(db: Db, sourceId: number, recipient: string): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(eq(notificationLog.relatedEntityType, ENTITY), eq(notificationLog.relatedEntityId, sourceId), eq(notificationLog.recipient, recipient), sql`${notificationLog.createdAt} >= current_date`))
    .limit(1);
  return !!row;
}

/**
 * Recalculates due/overdue and tells the right people. Safe to run more than once a
 * day: a (source, recipient) pair already notified today is skipped, not re-sent.
 * Never throws — a scheduler failure should not crash the server.
 */
export async function sweepFaiDue(): Promise<{ sources: number; notified: number }> {
  try {
    const db = ownerDb as unknown as Db;
    const today = isoToday();
    const due = await sourcesNeedingAttention(db, today);
    let notified = 0;
    for (const source of due) {
      const recipients = await recipientsForSite(db, source.siteId);
      const toNotify: string[] = [];
      for (const recipient of recipients) {
        if (!(await alreadyNotifiedToday(db, source.id, recipient))) toNotify.push(recipient);
      }
      if (toNotify.length > 0) {
        const subject = subjectFor(source);
        notified += await notifyInApp(db, toNotify, subject, subject, ENTITY, source.id);
      }
      // Phase 3: email, via the distribution lists — separate recipient set and separate
      // dedupe rule (by status change, not by day) from the in-app notice above.
      await notifyDueReminder(db, source, source.dueStatus as "due_soon" | "overdue");
    }
    if (due.length > 0) {
      await recordAuditTrailStandalone(pool, {
        entityType: ENTITY,
        entityId: 0,
        action: "status_change",
        changes: { what: "FAI due/overdue sweep", description: `System (FAI scheduler): recalculated due/overdue status for ${due.length} approved source(s) and notified ${notified} recipient(s).` },
      });
    }
    return { sources: due.length, notified };
  } catch (err) {
    logger.error("FAI due sweep failed", { err: String(err) });
    return { sources: 0, notified: 0 };
  }
}

async function tick(): Promise<void> {
  await sweepFaiDue();
  // Phase 3: the Monday-7am-company-time summary. Checked every tick, but it only actually
  // sends during that one hour each week (see isMondaySevenAmHour) — hourly cadence (below)
  // is what makes that check meaningfully close to "7:00 AM", not the once-a-day cadence
  // Phase 2 used, which could land anywhere in the day depending on server start time.
  await sendMondaySummaries();
}

let sweepHandle: ReturnType<typeof setInterval> | null = null;
/** Runs hourly (plus a startup pass a few minutes in, same convention as calibration/training's sweeps — "safe to run more than once a day" per Phase 2's own spec). Idempotent. */
export function startFaiScheduler(): void {
  if (sweepHandle) return;
  const first = setTimeout(() => void tick(), 4 * 60_000);
  first.unref?.();
  sweepHandle = setInterval(() => void tick(), 3_600_000);
  sweepHandle.unref?.();
}
export function stopFaiScheduler(): void {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}
