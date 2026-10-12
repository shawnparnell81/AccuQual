import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { db as ownerDb, pool } from "../../db/index.js";
import { logger } from "../../utils/logger.js";
import { AppError } from "../../utils/appError.js";
import { env } from "../../config/env.js";
import { appRecordUrl } from "../../lib/recordLink.js";
import { recordAuditTrail, recordAuditTrailStandalone } from "../audit-trail/audit-trail.service.js";
import { roleHasPermission } from "../roles/rolePermissions.js";
import { FAI_NOTIFICATIONS_MANAGE_PERMISSION } from "../roles/roleAccess.js";
import { faiDistributionLists, type FaiDistributionMember } from "../../drizzle/schema/faiNotifications.js";
import { inspApprovedSources, inspRecords } from "../../drizzle/schema/faiInspection.js";
import { faiRandomPullBatches, faiRandomPullItems } from "../../drizzle/schema/faiScheduling.js";
import { users } from "../../drizzle/schema/users.js";
import { company } from "../../drizzle/schema/company.js";
import { notificationLog } from "../../drizzle/schema/notifications.js";
import { faiEmailAllowed, notifyRecipients } from "../notifications/notification.service.js";
import { safeTimeZone } from "../quality-automation/logic.js";
import { listMatchesEvent, type FaiEventContext } from "./fai-notification-match.js";
import { dueStatusFor } from "./fai-due-status.js";

const ENTITY = "FAI Distribution List";

// Not imported from fai-inspection.service.ts (which would create a circular import once that
// file calls into this one for the awaiting-signoff/passed/failed hooks) — same tiny
// deny/requirePerm pair every FAI-module file duplicates rather than share.
async function deny(db: Db, user: any, permission: string, what: string) {
  await recordAuditTrailStandalone(pool, {
    entityType: ENTITY, entityId: 0, action: "permission_denied",
    changes: { permission, description: `User lacks ${permission}: ${what}` },
    performedBy: user?.id ?? null,
  });
  throw AppError.forbidden(`You don't have permission to ${what}.`);
}

async function requirePerm(db: Db, user: any, permission: string, what: string) {
  const roleName = user?.role ?? user?.roleName;
  const allowed = await roleHasPermission(db, roleName, permission);
  if (!allowed) await deny(db, user, permission, what);
}

/* ---------------- Distribution lists ---------------- */

export async function listDistributionLists(db: Db, user: any) {
  await requirePerm(db, user, FAI_NOTIFICATIONS_MANAGE_PERMISSION, "view FAI distribution lists");
  return db.select().from(faiDistributionLists).orderBy(desc(faiDistributionLists.id));
}

export async function createDistributionList(db: Db, user: any, input: any) {
  await requirePerm(db, user, FAI_NOTIFICATIONS_MANAGE_PERMISSION, "create FAI distribution lists");
  const [created] = await db.insert(faiDistributionLists).values({
    name: input.name,
    members: input.members ?? [],
    matchSiteId: input.matchSiteId ?? null,
    matchProductFamily: input.matchProductFamily ?? null,
    matchTriggerReason: input.matchTriggerReason ?? null,
    matchEventTypes: input.matchEventTypes ?? [],
    mondaySummary: input.mondaySummary ?? false,
    createdBy: user?.id ?? null,
  }).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: created!.id, action: "create",
    changes: { what: "FAI distribution list", description: `Created distribution list "${input.name}".` },
    performedBy: user?.id ?? null,
  });
  return created!;
}

export async function updateDistributionList(db: Db, user: any, id: number, input: any) {
  await requirePerm(db, user, FAI_NOTIFICATIONS_MANAGE_PERMISSION, "edit FAI distribution lists");
  const [existing] = await db.select().from(faiDistributionLists).where(eq(faiDistributionLists.id, id));
  if (!existing) throw AppError.notFound("Distribution list not found.");
  const patch: any = { updatedAt: new Date() };
  for (const k of ["name", "members", "matchSiteId", "matchProductFamily", "matchTriggerReason", "matchEventTypes", "mondaySummary"] as const) {
    if (input[k] !== undefined) patch[k] = input[k];
  }
  const [updated] = await db.update(faiDistributionLists).set(patch).where(eq(faiDistributionLists.id, id)).returning();
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "update",
    changes: { what: "FAI distribution list", description: `Updated distribution list "${existing.name}".` },
    performedBy: user?.id ?? null,
  });
  return updated!;
}

export async function deleteDistributionList(db: Db, user: any, id: number) {
  await requirePerm(db, user, FAI_NOTIFICATIONS_MANAGE_PERMISSION, "delete FAI distribution lists");
  const [existing] = await db.select().from(faiDistributionLists).where(eq(faiDistributionLists.id, id));
  if (!existing) throw AppError.notFound("Distribution list not found.");
  await db.delete(faiDistributionLists).where(eq(faiDistributionLists.id, id));
  await recordAuditTrail(db, {
    entityType: ENTITY, entityId: id, action: "delete",
    changes: { what: "FAI distribution list", description: `Deleted distribution list "${existing.name}".` },
    performedBy: user?.id ?? null,
  });
  return { ok: true };
}

/* ---------------- Resolving members to real, current email addresses ---------------- */

async function resolveMemberEmails(db: Db, members: FaiDistributionMember[]): Promise<string[]> {
  const userIds = members.filter((m) => m.type === "user" && m.userId).map((m) => m.userId!);
  const typed = members.filter((m) => m.type === "email" && m.email).map((m) => m.email!);
  if (userIds.length === 0) return [...new Set(typed)];
  const rows = await db.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users);
  const byId = new Map(rows.map((r: any) => [r.id as number, r]));
  const looked = userIds.map((id) => byId.get(id)).filter((r: any): r is { email: string; isActive: boolean } => !!r && r.isActive).map((r: any) => r.email as string);
  return [...new Set([...looked, ...typed])];
}

/* ---------------- Sending an event to whichever lists match it ---------------- */

/**
 * Sends one event to every matching list's members. Never throws — a failed or
 * unconfigured mail transport still lets the triggering action (sign-off, etc.)
 * complete; the failure is logged (notification_log's own "failed" status, already
 * visible on the System Health email check) rather than surfaced to the signer.
 * `dedupeKey`, when given, skips a recipient who already got the exact same subject
 * for this entity — used for the due/overdue reminder so it fires once per status
 * CHANGE, not once per day the status stays the same.
 */
export async function sendFaiEvent(db: Db, ctx: FaiEventContext, opts: { subject: string; body: string; entityId: number; dedupe?: boolean }): Promise<{ sent: number }> {
  try {
    const lists = (await db.select().from(faiDistributionLists)).filter((l: any) => listMatchesEvent(l, ctx));
    if (lists.length === 0) return { sent: 0 };
    const allEmails = new Set<string>();
    for (const list of lists) for (const email of await resolveMemberEmails(db, list.members as FaiDistributionMember[])) allEmails.add(email);
    if (allEmails.size === 0) return { sent: 0 };

    let sent = 0;
    for (const recipient of allEmails) {
      if (!(await faiEmailAllowed(db, recipient))) continue;
      if (opts.dedupe) {
        const [already] = await db.select({ id: notificationLog.id }).from(notificationLog)
          .where(and(eq(notificationLog.channel, "email"), eq(notificationLog.relatedEntityType, ENTITY), eq(notificationLog.relatedEntityId, opts.entityId), eq(notificationLog.subject, opts.subject), eq(notificationLog.recipient, recipient)))
          .limit(1);
        if (already) continue;
      }
      await notifyRecipients(db, [recipient], opts.subject, opts.body, ENTITY, opts.entityId);
      sent++;
    }
    return { sent };
  } catch (err) {
    logger.error("FAI event email failed", { event: ctx.eventType, err: String(err) });
    return { sent: 0 };
  }
}

function recordLink(id: number): string {
  return appRecordUrl(env.FRONTEND_URL, `/fai-inspection/records/${id}`);
}

export async function notifyAwaitingSignoff(db: Db, rec: { id: number; faiNumber: string; partNumber: string; siteId: number | null; triggerReason: string | null }, productFamily: string | null) {
  return sendFaiEvent(db, { eventType: "awaiting_signoff", siteId: rec.siteId, productFamily, triggerReason: rec.triggerReason }, {
    entityId: rec.id,
    subject: `FAI ${rec.faiNumber} (${rec.partNumber}) is awaiting sign-off`,
    body: `FAI ${rec.faiNumber} for part ${rec.partNumber} is ready for sign-off.\n\nOpen it: ${recordLink(rec.id)}`,
  });
}

export async function notifySignedOff(db: Db, rec: { id: number; faiNumber: string; partNumber: string; siteId: number | null; triggerReason: string | null }, outcome: "passed" | "failed", productFamily: string | null) {
  const base = `FAI ${rec.faiNumber} (${rec.partNumber}) signed ${outcome.toUpperCase()}`;
  const body = outcome === "failed"
    ? `FAI ${rec.faiNumber} for part ${rec.partNumber} was signed FAILED.\n\nOpen it: ${recordLink(rec.id)}\n\nReminder: review whether this needs an NCR — that's still a manual step.`
    : `FAI ${rec.faiNumber} for part ${rec.partNumber} was signed PASSED.\n\nOpen it: ${recordLink(rec.id)}`;
  return sendFaiEvent(db, { eventType: outcome, siteId: rec.siteId, productFamily, triggerReason: rec.triggerReason }, { entityId: rec.id, subject: base, body });
}

export async function notifyRandomPullApproved(db: Db, batch: { id: number; year: number }, items: { partNumber: string | null; supplierFactory: string | null; siteId: number | null }[]) {
  const lines = items.map((i) => `- ${i.partNumber ?? "?"}${i.supplierFactory ? ` / ${i.supplierFactory}` : ""}`);
  // A batch can span several plants; match against each one represented so a plant-scoped list still hears about its own sources.
  const sitesInBatch = [...new Set(items.map((i) => i.siteId))];
  const targets = sitesInBatch.length > 0 ? sitesInBatch : [null];
  let sent = 0;
  for (const siteId of targets) {
    const r = await sendFaiEvent(db, { eventType: "random_pull_approved", siteId, productFamily: null, triggerReason: null }, {
      entityId: batch.id,
      subject: `${batch.year} random-pull list approved (${items.length} source${items.length === 1 ? "" : "s"})`,
      body: `The ${batch.year} annual random-pull list was approved.\n\nPicked:\n${lines.join("\n")}`,
    });
    sent += r.sent;
  }
  return { sent };
}

/** Called by the daily/hourly sweep. Sends an email for a source that just transitioned to due_soon or overdue (subject-based dedupe means it won't re-fire every tick while the status stays the same). */
export async function notifyDueReminder(db: Db, source: { id: number; partNumber: string; siteId: number | null; nextDueDate: string | null }, dueStatus: "due_soon" | "overdue") {
  const subject = dueStatus === "overdue"
    ? `${source.partNumber} FAI is overdue (was due ${source.nextDueDate})`
    : `${source.partNumber} FAI due ${source.nextDueDate}`;
  return sendFaiEvent(db, { eventType: "due_reminder", siteId: source.siteId, productFamily: null, triggerReason: null }, {
    entityId: source.id, subject, body: subject, dedupe: true,
  });
}

/* ---------------- Monday 7am summary ---------------- */

function isMondaySevenAmHour(now: Date, timeZone: string): boolean {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", hour: "numeric", hour12: false }).formatToParts(now);
  const weekday = parts.find((p) => p.type === "weekday")?.value;
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "-1");
  return weekday === "Mon" && hour === 7;
}

function isoWeekLabel(now: Date, timeZone: string): string {
  return `Week of ${new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(now)}`;
}

/** Figures for one list's digest, honoring that list's own plant filter if it has one. */
async function digestFigures(db: Db, siteId: number | null) {
  const sf = siteId ? eq(inspRecords.siteId, siteId) : undefined;
  const count = async (statuses: string[]) => {
    const [r] = await db.select({ n: sql<number>`count(*)` }).from(inspRecords).where(sf ? and(sf, inArray(inspRecords.status, statuses)) : inArray(inspRecords.status, statuses));
    return Number(r!.n);
  };
  const open = await count(["draft", "in_inspection"]);
  const awaiting = await count(["awaiting_signoff"]);
  const sevenDaysAgo = new Date(Date.now() - 7 * 86_400_000);
  const [failed7] = await db.select({ n: sql<number>`count(*)` }).from(inspRecords)
    .where(sf ? and(sf, eq(inspRecords.status, "failed"), gte(inspRecords.updatedAt, sevenDaysAgo)) : and(eq(inspRecords.status, "failed"), gte(inspRecords.updatedAt, sevenDaysAgo)));

  // Not imported from fai-scheduler.service.ts (that would be circular — it calls into this
  // file for the due-reminder email), so this repeats that file's small "approved + computed
  // dueStatus" query rather than sharing the function.
  const sourceRows = await db
    .select({ siteId: inspApprovedSources.siteId, nextDueDate: inspApprovedSources.nextDueDate })
    .from(inspApprovedSources)
    .where(siteId ? and(eq(inspApprovedSources.status, "approved"), eq(inspApprovedSources.siteId, siteId)) : eq(inspApprovedSources.status, "approved"));
  const statuses = sourceRows.map((r: any) => dueStatusFor(r.nextDueDate));
  const due30 = statuses.filter((s: string | null) => s === "due_soon").length;
  const overdue = statuses.filter((s: string | null) => s === "overdue").length;

  const approvedBatches = await db.select({ id: faiRandomPullBatches.id }).from(faiRandomPullBatches).where(eq(faiRandomPullBatches.status, "approved"));
  let pullsPending = 0;
  if (approvedBatches.length > 0) {
    const items = await db.select({ linkedRecordId: faiRandomPullItems.linkedRecordId }).from(faiRandomPullItems).where(inArray(faiRandomPullItems.batchId, approvedBatches.map((b: any) => b.id)));
    pullsPending = items.filter((i: any) => i.linkedRecordId == null).length;
  }

  return { open, awaitingSignoff: awaiting, failed7: Number(failed7!.n), due30, overdue, pullsPending };
}

/** Called from the sweep. Only actually sends on the Monday-7am hour in the company's configured timezone (no per-plant timezone concept exists elsewhere in this app, so "plant time" here is the one company-wide timezone — see company.profile.timezone). */
export async function sendMondaySummaries(now: Date = new Date()): Promise<{ sent: number }> {
  try {
    const db = ownerDb as unknown as Db;
    const [co] = await db.select({ profile: company.profile }).from(company).limit(1);
    const timeZone = safeTimeZone(co?.profile?.timezone);
    if (!isMondaySevenAmHour(now, timeZone)) return { sent: 0 };

    const lists = (await db.select().from(faiDistributionLists)).filter((l: any) => l.mondaySummary);
    if (lists.length === 0) return { sent: 0 };
    const week = isoWeekLabel(now, timeZone);
    let sent = 0;
    for (const list of lists) {
      const figures = await digestFigures(db, list.matchSiteId);
      const subject = `Weekly FAI Summary — ${week}${list.name ? ` — ${list.name}` : ""}`;
      const body = [
        `Open FAIs: ${figures.open}`,
        `Awaiting sign-off: ${figures.awaitingSignoff}`,
        `Failures (last 7 days): ${figures.failed7}`,
        `Due in 30 days: ${figures.due30}`,
        `Overdue: ${figures.overdue}`,
        `Random pulls pending: ${figures.pullsPending}`,
      ].join("\n");
      const emails = await resolveMemberEmails(db, list.members as FaiDistributionMember[]);
      for (const recipient of emails) {
        if (!(await faiEmailAllowed(db, recipient))) continue;
        const [already] = await db.select({ id: notificationLog.id }).from(notificationLog)
          .where(and(eq(notificationLog.channel, "email"), eq(notificationLog.subject, subject), eq(notificationLog.recipient, recipient)))
          .limit(1);
        if (already) continue;
        await notifyRecipients(db, [recipient], subject, body, "FaiWeeklySummary", list.id);
        sent++;
      }
    }
    if (sent > 0) {
      await recordAuditTrailStandalone(pool, {
        entityType: "FaiWeeklySummary", entityId: 0, action: "create",
        changes: { description: `System (FAI scheduler): sent ${sent} weekly FAI summary email(s) for ${week}.` },
      });
    }
    return { sent };
  } catch (err) {
    logger.error("FAI weekly summary failed", { err: String(err) });
    return { sent: 0 };
  }
}
