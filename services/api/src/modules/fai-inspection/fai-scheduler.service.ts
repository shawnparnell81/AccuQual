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

/** Already notified today? One check per (source, recipient) so a second sweep the same day is a no-op. */
async function alreadyNotifiedToday(db: Db, sourceId: number, recipient: string, startOfToday: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: notificationLog.id })
    .from(notificationLog)
    .where(and(eq(notificationLog.relatedEntityType, ENTITY), eq(notificationLog.relatedEntityId, sourceId), eq(notificationLog.recipient, recipient), gte(notificationLog.createdAt, startOfToday)))
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
    const startOfToday = new Date(today + "T00:00:00.000Z");
    const due = await sourcesNeedingAttention(db, today);
    let notified = 0;
    for (const source of due) {
      const recipients = await recipientsForSite(db, source.siteId);
      const toNotify: string[] = [];
      for (const recipient of recipients) {
        if (!(await alreadyNotifiedToday(db, source.id, recipient, startOfToday))) toNotify.push(recipient);
      }
      if (toNotify.length === 0) continue;
      const subject = subjectFor(source);
      notified += await notifyInApp(db, toNotify, subject, subject, ENTITY, source.id);
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

let sweepHandle: ReturnType<typeof setInterval> | null = null;
/** Runs once a day (plus a startup pass a few minutes in, same convention as calibration/training's sweeps). Idempotent. */
export function startFaiScheduler(): void {
  if (sweepHandle) return;
  const first = setTimeout(() => void sweepFaiDue(), 4 * 60_000);
  first.unref?.();
  sweepHandle = setInterval(() => void sweepFaiDue(), 24 * 3_600_000);
  sweepHandle.unref?.();
}
export function stopFaiScheduler(): void {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}
