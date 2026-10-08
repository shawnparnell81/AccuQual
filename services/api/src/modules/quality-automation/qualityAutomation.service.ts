import { and, eq, gte, inArray, sql } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { db as ownerDb } from "../../db/index.js";
import { env } from "../../config/env.js";
import { logger } from "../../utils/logger.js";
import { company } from "../../drizzle/schema/company.js";
import { users } from "../../drizzle/schema/users.js";
import { roles } from "../../drizzle/schema/roles.js";
import { ncr } from "../../drizzle/schema/ncr.js";
import { capa } from "../../drizzle/schema/capa.js";
import { eightD } from "../../drizzle/schema/eightD.js";
import { documents } from "../../drizzle/schema/documents.js";
import { formData } from "../../drizzle/schema/forms.js";
import { quarantineRecords } from "../../drizzle/schema/quarantine.js";
import { workflowDefinitions, workflowRuns } from "../../drizzle/schema/workflow.js";
import { qualityReminderLog } from "../../drizzle/schema/qualityAutomation.js";
import { notifyRecipients, normalizeNotificationPreferences } from "../notifications/notification.service.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { publishEvent, WORKFLOW_STREAM } from "../../lib/eventBus.js";
import { OPEN_NCR_STATUSES, canonicalNcrStep, ncrStepLabel } from "../ncr/ncr.workflow.js";
import { showRecordNumber } from "../records/userRecordNumber.js";
import { AppError } from "../../utils/appError.js";
import { assertRecordOnAllowedSite } from "../sites/siteAccess.js";
import {
  ageInCalendarDays,
  calendarDay,
  canDecideApproval,
  classifyDue,
  eightDDueDate,
  eightDIsClosed,
  escalationRecipients,
  findRepeatCluster,
  noticeCopy,
  ownerEmail,
  recordHref,
  renderNoticeEmail,
  resolveQualityAutomationSettings,
  safeTimeZone,
  signalsFromNcr,
  type DueKind,
  type EmailItem,
  type EscalationPerson,
  type QualityAutomationSettings,
  type RepeatSignals,
} from "./logic.js";

const OPEN_CAPA = ["open", "in_progress", "verifying"] as const;
const OPEN_NCR = OPEN_NCR_STATUSES;

interface Claim {
  kind: string;
  entityType: string;
  entityId: number;
  recipient: string;
  bucket: string;
  item: EmailItem;
}

export async function getQualityAutomationSettings(db: Db): Promise<QualityAutomationSettings> {
  const [row] = await db.select({ settings: company.qualityAutomationSettings, profile: company.profile }).from(company);
  return resolveQualityAutomationSettings(row?.settings);
}

async function companyTimeZone(db: Db): Promise<string> {
  const [row] = await db.select({ profile: company.profile }).from(company);
  return safeTimeZone(row?.profile?.timezone);
}

async function loadPeople(db: Db): Promise<PersonWithPrefs[]> {
  const rows = await db
    .select({
      id: users.id,
      email: users.email,
      isActive: users.isActive,
      managerId: users.managerId,
      roleName: roles.name,
      department: users.department,
      notificationPreferences: users.notificationPreferences,
    })
    .from(users)
    .leftJoin(roles, eq(users.roleId, roles.id));
  return rows;
}

function wantsEmail(person: EscalationPerson & { notificationPreferences?: { email?: boolean } | null }): boolean {
  return normalizeNotificationPreferences(person.notificationPreferences).email;
}

function wantsDigest(person: EscalationPerson & { notificationPreferences?: { dailyDigest?: boolean; email?: boolean } | null }): boolean {
  const prefs = normalizeNotificationPreferences(person.notificationPreferences);
  return person.isActive && prefs.email && prefs.dailyDigest;
}

async function sendClaims(db: Db, claims: Claim[], relatedEntityType?: string, relatedEntityId?: number): Promise<number> {
  const kept: Claim[] = [];
  for (const claim of claims) {
    const [row] = await db
      .insert(qualityReminderLog)
      .values({ kind: claim.kind, entityType: claim.entityType, entityId: claim.entityId, recipient: claim.recipient, bucket: claim.bucket })
      .onConflictDoNothing({ target: [qualityReminderLog.kind, qualityReminderLog.entityType, qualityReminderLog.entityId, qualityReminderLog.recipient, qualityReminderLog.bucket] })
      .returning({ id: qualityReminderLog.id });
    if (row) kept.push(claim);
  }
  const groups = new Map<string, Claim[]>();
  for (const claim of kept) {
    const key = `${claim.recipient}\0${claim.kind}`;
    const list = groups.get(key) ?? [];
    list.push(claim);
    groups.set(key, list);
  }
  let sent = 0;
  for (const group of groups.values()) {
    const kind = group[0]!.kind;
    const copy = noticeCopy(kind, group.length);
    const subject = kind === "due_soon" || kind === "due_today" || kind === "overdue" || kind === "escalated" ? `${copy.subject}: ${group.length === 1 ? group[0]!.item.label : `${group.length} records`}` : copy.subject;
    const rendered = renderNoticeEmail({ heading: copy.heading, intro: copy.intro, items: group.map((claim) => claim.item) });
    await notifyRecipients(db, [group[0]!.recipient], subject, rendered.text, relatedEntityType ?? group[0]!.entityType, relatedEntityId ?? group[0]!.entityId, rendered.html);
    sent += 1;
  }
  return sent;
}

function href(path: string): string {
  return recordHref(env.FRONTEND_URL, path);
}

function dueDetail(kind: DueKind, due: Date, timeZone: string): string {
  const day = calendarDay(due, timeZone);
  if (kind === "due_soon") return `Due ${day}`;
  if (kind === "due_today") return `Due today (${day})`;
  if (kind === "overdue") return `Overdue since ${day}`;
  return `Escalated — due ${day}`;
}

interface PersonWithPrefs extends EscalationPerson {
  notificationPreferences?: { inApp?: boolean; email?: boolean; dailyDigest?: boolean } | null;
}

export async function runQualityAutomation(db: Db, now = new Date()): Promise<{ emails: number }> {
  const settings = await getQualityAutomationSettings(db);
  const timeZone = await companyTimeZone(db);
  const people = await loadPeople(db);
  const claims: Claim[] = [];
  const digest = new Map<number, EmailItem[]>();

  function addDigest(userId: number | null | undefined, item: EmailItem) {
    if (userId == null) return;
    const list = digest.get(userId) ?? [];
    if (list.some((existing) => existing.href === item.href && existing.label === item.label)) return;
    list.push(item);
    digest.set(userId, list);
  }

  function remind(input: { kind: string; entityType: string; entityId: number; bucket: string; recipients: string[]; item: EmailItem }) {
    const seen = new Set<string>();
    for (const recipient of input.recipients) {
      const person = people.find((row) => row.email === recipient);
      if (!recipient || seen.has(recipient) || (person && !wantsEmail(person))) continue;
      seen.add(recipient);
      claims.push({ kind: input.kind, entityType: input.entityType, entityId: input.entityId, bucket: input.bucket, recipient, item: input.item });
    }
  }

  const ncrRows = await db.select().from(ncr).where(and(eq(ncr.isDeleted, false), inArray(ncr.status, [...OPEN_NCR])));
  for (const row of ncrRows) {
    const ownerId = row.assignedTo;
    const touched = row.updatedAt ?? row.createdAt ?? now;
    const step = ncrStepLabel(canonicalNcrStep(row.status));
    const itemBase = { label: `NCR #${row.id}`, href: href(`/ncr/${row.id}`) };
    if (row.dueDate) {
      const kind = classifyDue(row.dueDate, now, settings, timeZone);
      if (kind) {
        const item = { ...itemBase, detail: `${step} — ${row.title} — ${dueDetail(kind, row.dueDate, timeZone)}` };
        const recipients = kind === "escalated" ? escalationRecipients(ownerId, people) : [ownerEmail(ownerId, people) ?? ""].filter(Boolean);
        const fallback = recipients.length > 0 ? recipients : escalationRecipients(ownerId, people);
        remind({ kind, entityType: "NCR", entityId: row.id, bucket: `${kind}:${calendarDay(row.dueDate, timeZone)}`, recipients: fallback, item });
        if (kind === "due_soon" || kind === "due_today" || kind === "overdue" || kind === "escalated") addDigest(ownerId, item);
      }
    }
    if (ageInCalendarDays(touched, now, timeZone) >= settings.stuckDays) {
      const item = { ...itemBase, detail: `${step} — ${row.title} — no update for ${settings.stuckDays}+ days` };
      remind({
        kind: "escalated",
        entityType: "NCR",
        entityId: row.id,
        bucket: `stuck:${calendarDay(touched, timeZone)}`,
        recipients: escalationRecipients(ownerId, people),
        item,
      });
      addDigest(ownerId, item);
    }
  }

  const capaRows = await db.select().from(capa).where(inArray(capa.status, [...OPEN_CAPA]));
  for (const row of capaRows) {
    const touched = row.updatedAt ?? row.createdAt ?? now;
    const itemBase = { label: `CAPA #${row.id}`, href: href(`/capa/${row.id}`) };
    if (row.dueDate) {
      const kind = classifyDue(row.dueDate, now, settings, timeZone);
      if (kind) {
        const item = { ...itemBase, detail: dueDetail(kind, row.dueDate, timeZone) };
        const recipients = kind === "escalated" ? escalationRecipients(row.ownerId, people) : [ownerEmail(row.ownerId, people) ?? ""].filter(Boolean);
        remind({
          kind,
          entityType: "CAPA",
          entityId: row.id,
          bucket: `${kind}:${calendarDay(row.dueDate, timeZone)}`,
          recipients: recipients.length > 0 ? recipients : escalationRecipients(row.ownerId, people),
          item,
        });
        addDigest(row.ownerId, item);
      }
    }
    if (ageInCalendarDays(touched, now, timeZone) >= settings.stuckDays) {
      const item = { ...itemBase, detail: `No update for ${settings.stuckDays}+ days` };
      remind({ kind: "escalated", entityType: "CAPA", entityId: row.id, bucket: `stuck:${calendarDay(touched, timeZone)}`, recipients: escalationRecipients(row.ownerId, people), item });
      addDigest(row.ownerId, item);
    }
  }

  const eightRows = await db.select().from(eightD);
  const linkedNcrIds = eightRows.map((row) => row.ncrId).filter((id): id is number => id != null);
  const linkedNcrs = linkedNcrIds.length === 0 ? [] : await db.select({ id: ncr.id, assignedTo: ncr.assignedTo }).from(ncr).where(inArray(ncr.id, linkedNcrIds));
  const ncrOwner = new Map(linkedNcrs.map((row) => [row.id, row.assignedTo]));
  for (const row of eightRows) {
    const data = (row.data ?? {}) as Record<string, unknown>;
    if (eightDIsClosed(data)) continue;
    const ownerId = row.ncrId != null ? ncrOwner.get(row.ncrId) ?? null : null;
    const touched = row.updatedAt ?? row.createdAt ?? now;
    const due = eightDDueDate(data);
    const itemBase = { label: `8D #${row.id}`, href: href(`/8d/${row.id}`) };
    if (due) {
      const kind = classifyDue(due, now, settings, timeZone);
      if (kind) {
        const item = { ...itemBase, detail: `Step D${row.currentStep} — ${dueDetail(kind, due, timeZone)}` };
        const recipients = kind === "escalated" ? escalationRecipients(ownerId, people) : [ownerEmail(ownerId, people) ?? ""].filter(Boolean);
        remind({
          kind,
          entityType: "8D",
          entityId: row.id,
          bucket: `${kind}:${calendarDay(due, timeZone)}`,
          recipients: recipients.length > 0 ? recipients : escalationRecipients(ownerId, people),
          item,
        });
        addDigest(ownerId, item);
      }
    }
    if (ageInCalendarDays(touched, now, timeZone) >= settings.stuckDays) {
      const item = { ...itemBase, detail: `Still on D${row.currentStep} — no update for ${settings.stuckDays}+ days` };
      remind({ kind: "escalated", entityType: "8D", entityId: row.id, bucket: `stuck:${calendarDay(touched, timeZone)}`, recipients: escalationRecipients(ownerId, people), item });
      addDigest(ownerId, item);
    }
  }

  const inReview = await db.select().from(documents).where(and(eq(documents.status, "in_review"), eq(documents.isDeleted, false)));
  for (const doc of inReview) {
    const touched = doc.updatedAt ?? doc.createdAt ?? now;
    const waiting = ageInCalendarDays(touched, now, timeZone);
    const item = { label: doc.title || `Document #${doc.id}`, detail: `In review for ${waiting} day${waiting === 1 ? "" : "s"}`, href: href(`/documents/${doc.id}`) };
    addDigest(doc.ownerId, item);
    for (const person of people) {
      if (person.roleName === "quality_manager" || person.roleName === "admin" || person.roleName === "owner" || person.roleName === "president" || person.roleName === "vice_president") addDigest(person.id, item);
    }
    if (waiting < settings.approvalStuckDays) continue;
    const recipients = [
      ownerEmail(doc.ownerId, people),
      ...people.filter((person) => person.isActive && (person.roleName === "quality_manager" || person.roleName === "admin" || person.roleName === "owner" || person.roleName === "president" || person.roleName === "vice_president")).map((person) => person.email),
    ].filter((email): email is string => !!email);
    remind({ kind: "approval", entityType: "Document", entityId: doc.id, bucket: `stuck:${calendarDay(touched, timeZone)}`, recipients, item });
  }

  const waitingRuns = await db
    .select({
      id: workflowRuns.id,
      workflowId: workflowRuns.workflowId,
      startedAt: workflowRuns.startedAt,
      context: workflowRuns.context,
      name: workflowDefinitions.name,
      module: workflowDefinitions.module,
    })
    .from(workflowRuns)
    .innerJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowRuns.workflowId))
    .where(and(eq(workflowRuns.status, "waiting_approval"), eq(workflowRuns.simulated, false)));

  for (const run of waitingRuns) {
    if (run.module !== "validation" && run.name !== "Validation") continue;
    const started = run.startedAt ?? now;
    const waiting = ageInCalendarDays(started, now, timeZone);
    const pending = (run.context as { pendingApproval?: { label?: string; approverRole?: string; approverDepartment?: string } } | null)?.pendingApproval;
    const step = pending?.label || "Sign-off";
    const item = { label: `${run.name}: ${step}`, detail: `Waiting ${waiting} day${waiting === 1 ? "" : "s"}`, href: href(`/workflow/${run.workflowId}`) };
    for (const person of people) {
      if (person.isActive && pending && canDecideApproval(person, pending)) addDigest(person.id, item);
    }
    if (waiting < settings.approvalStuckDays) continue;
    const recipients = people
      .filter((person) => person.isActive && pending && canDecideApproval(person, pending))
      .map((person) => person.email);
    const target = recipients.length > 0 ? recipients : escalationRecipients(null, people);
    remind({ kind: "approval", entityType: "Validation", entityId: run.id, bucket: `stuck:${calendarDay(started, timeZone)}`, recipients: target, item });
  }

  const today = calendarDay(now, timeZone);
  let emails = await sendClaims(db, claims);
  for (const person of people) {
    if (!wantsDigest(person)) continue;
    const items = digest.get(person.id) ?? [];
    if (items.length === 0) continue;
    const [row] = await db
      .insert(qualityReminderLog)
      .values({ kind: "digest", entityType: "User", entityId: person.id, recipient: person.email, bucket: today })
      .onConflictDoNothing({ target: [qualityReminderLog.kind, qualityReminderLog.entityType, qualityReminderLog.entityId, qualityReminderLog.recipient, qualityReminderLog.bucket] })
      .returning({ id: qualityReminderLog.id });
    if (!row) continue;
    const copy = noticeCopy("digest", items.length);
    const rendered = renderNoticeEmail({ heading: copy.heading, intro: copy.intro, items });
    await notifyRecipients(db, [person.email], copy.subject, rendered.text, "User", person.id, rendered.html);
    emails += 1;
  }
  return { emails };
}

export async function sweepQualityAutomation(): Promise<{ emails: number }> {
  try {
    return await runQualityAutomation(ownerDb as unknown as Db);
  } catch (err) {
    logger.error("Quality reminder sweep failed", { err: String(err) });
    return { emails: 0 };
  }
}

let sweepHandle: ReturnType<typeof setInterval> | null = null;

/** Once every six hours, same cadence as calibration and training. Each notice is sent once per episode. */
export function startQualityAutomationSweep(): void {
  if (sweepHandle) return;
  const first = setTimeout(() => void sweepQualityAutomation(), 2 * 60_000);
  first.unref?.();
  sweepHandle = setInterval(() => void sweepQualityAutomation(), 6 * 3_600_000);
  sweepHandle.unref?.();
}

export function stopQualityAutomationSweep(): void {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
}

interface LoadedRepeat {
  settings: QualityAutomationSettings;
  cluster: RepeatSignals[];
  openCapaId: number | null;
}

async function loadRepeatCluster(db: Db, ncrId: number, now = new Date()): Promise<LoadedRepeat & { subjectSiteId: number | null }> {
  const settings = await getQualityAutomationSettings(db);
  const since = new Date(now.getTime() - settings.repeatNcrWindowDays * 86_400_000);
  const [subject] = await db.select().from(ncr).where(eq(ncr.id, ncrId));
  if (!subject || subject.isDeleted) return { settings, cluster: [], openCapaId: null, subjectSiteId: null };
  const rows = await db
    .select()
    .from(ncr)
    .where(and(eq(ncr.isDeleted, false), gte(ncr.createdAt, since)));
  const ids = [...new Set([ncrId, ...rows.map((row) => row.id)])];
  const forms = ids.length === 0 ? [] : await db.select().from(formData).where(and(eq(formData.formType, "ncr"), eq(formData.entityType, "ncr"), inArray(formData.entityId, ids)));
  const holds = ids.length === 0 ? [] : await db.select({ sourceId: quarantineRecords.sourceId, metadata: quarantineRecords.metadata }).from(quarantineRecords).where(and(eq(quarantineRecords.sourceType, "ncr"), inArray(quarantineRecords.sourceId, ids)));
  const formById = new Map(forms.map((row) => [row.entityId, (row.data ?? {}) as Record<string, unknown>]));
  const partsById = new Map<number, string[]>();
  for (const hold of holds) {
    if (hold.sourceId == null) continue;
    const part = (hold.metadata as { partNumber?: unknown } | null)?.partNumber;
    if (typeof part !== "string") continue;
    const list = partsById.get(hold.sourceId) ?? [];
    list.push(part);
    partsById.set(hold.sourceId, list);
  }
  const pool = rows.some((row) => row.id === subject.id) ? rows : [subject, ...rows];
  const signals = pool.map((row) =>
    signalsFromNcr({
      id: row.id,
      createdAt: row.createdAt ?? now,
      supplierId: row.supplierId,
      title: row.title,
      recordNumber: row.recordNumber,
      description: row.description,
      form: formById.get(row.id) ?? null,
      partNumbers: partsById.get(row.id) ?? [],
    }),
  );
  const cluster = findRepeatCluster(signals, ncrId, settings.repeatNcrWindowDays, settings.repeatNcrThreshold, now);
  const openCapaId = cluster.length === 0 ? null : await findOpenRepeatCapa(db, cluster.map((row) => row.id));
  return { settings, cluster, openCapaId, subjectSiteId: subject.siteId };
}

async function findOpenRepeatCapa(db: Db, ncrIds: number[]): Promise<number | null> {
  if (ncrIds.length === 0) return null;
  const open = await db.select({ id: capa.id, ncrId: capa.ncrId, repeatNcrIds: capa.repeatNcrIds, status: capa.status }).from(capa).where(inArray(capa.status, [...OPEN_CAPA]));
  const hit = open.find((row) => (row.ncrId != null && ncrIds.includes(row.ncrId)) || (row.repeatNcrIds ?? []).some((id) => ncrIds.includes(id)));
  return hit?.id ?? null;
}

export async function repeatReport(db: Db, ncrId: number, allowedSiteIds?: number[]) {
  const loaded = await loadRepeatCluster(db, ncrId);
  if (loaded.subjectSiteId == null && loaded.cluster.length === 0) {
    const [subject] = await db.select({ id: ncr.id }).from(ncr).where(eq(ncr.id, ncrId));
    if (!subject) throw AppError.notFound("NCR");
  }
  if (loaded.subjectSiteId != null) assertRecordOnAllowedSite(loaded.subjectSiteId, allowedSiteIds, "NCR");
  return {
    isRepeat: loaded.cluster.length > 0,
    threshold: loaded.settings.repeatNcrThreshold,
    windowDays: loaded.settings.repeatNcrWindowDays,
    openCapaId: loaded.openCapaId,
    matches: loaded.cluster.map((row) => ({
      id: row.id,
      title: row.title,
      part: row.part,
      supplierId: row.supplierId,
      defectCode: row.defectCode,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

function ncrNoticeLabel(row: { recordNumber?: string | null; title?: string | null } | undefined): string {
  const number = showRecordNumber(row?.recordNumber);
  if (number) return `NCR ${number}`;
  const title = row?.title?.trim();
  return title && title !== "NCR" ? title : "NCR";
}

/** Called after an NCR or its form is saved. Never throws — a reminder must not fail the save. */
export async function noteRepeatNcr(db: Db, ncrId: number): Promise<void> {
  try {
    const loaded = await loadRepeatCluster(db, ncrId);
    if (loaded.cluster.length === 0) return;
    const people = await loadPeople(db);
    const recipients = people.filter((person) => person.isActive && person.department === "quality" && wantsEmail(person)).map((person) => person.email);
    const target = recipients.length > 0 ? recipients : escalationRecipients(null, people);
    const bucket = loaded.cluster
      .map((row) => row.id)
      .sort((a, b) => a - b)
      .join(",");
    const claims: Claim[] = target.map((recipient) => ({
      kind: "repeat_ncr",
      entityType: "NCR",
      entityId: ncrId,
      recipient,
      bucket,
      item: {
        label: ncrNoticeLabel(loaded.cluster.find((row) => row.id === ncrId)),
        detail: `${loaded.cluster.length} NCRs in ${loaded.settings.repeatNcrWindowDays} days: ${loaded.cluster.map((row) => ncrNoticeLabel(row)).join(", ")}`,
        href: href(`/ncr/${ncrId}`),
      },
    }));
    for (const match of loaded.cluster) {
      if (match.id === ncrId) continue;
      for (const recipient of target) {
        claims.push({
          kind: "repeat_ncr",
          entityType: "NCR",
          entityId: match.id,
          recipient,
          bucket,
          item: { label: ncrNoticeLabel(match), detail: match.title, href: href(`/ncr/${match.id}`) },
        });
      }
    }
    await sendClaims(db, claims, "NCR", ncrId);
  } catch (err) {
    logger.error("Repeat NCR check failed", { ncrId, err: String(err) });
  }
}

export async function openRepeatCapa(db: Db, ncrId: number, actorId: number | undefined, allowedSiteIds?: number[]): Promise<{ capa: typeof capa.$inferSelect; created: boolean }> {
  const loaded = await loadRepeatCluster(db, ncrId);
  if (loaded.subjectSiteId != null) assertRecordOnAllowedSite(loaded.subjectSiteId, allowedSiteIds, "NCR");
  if (loaded.cluster.length === 0) throw AppError.badRequest("This NCR is not part of a repeat group yet.");
  const ids = loaded.cluster.map((row) => row.id);
  if (loaded.openCapaId) {
    const [existing] = await db.select().from(capa).where(eq(capa.id, loaded.openCapaId));
    if (!existing) throw AppError.notFound("CAPA");
    const merged = [...new Set([...(existing.repeatNcrIds ?? []), ...ids])];
    if (merged.length !== (existing.repeatNcrIds ?? []).length) {
      const [updated] = await db.update(capa).set({ repeatNcrIds: merged, updatedAt: new Date() }).where(eq(capa.id, existing.id)).returning();
      return { capa: updated ?? existing, created: false };
    }
    return { capa: existing, created: false };
  }
  const [subject] = await db.select().from(ncr).where(eq(ncr.id, ncrId));
  const summary = `Repeat nonconformance — ${ids.length} NCRs in ${loaded.settings.repeatNcrWindowDays} days (${loaded.cluster.map((row) => ncrNoticeLabel(row)).join(", ")}).`;
  const [created] = await db
    .insert(capa)
    .values({
      ncrId,
      rootCause: summary,
      status: "open",
      escalationSource: "repeat_ncr",
      supplierId: subject?.supplierId ?? null,
      siteId: subject?.siteId ?? null,
      repeatNcrIds: ids,
    })
    .returning();
  if (!created) throw new AppError("Failed to open CAPA", 500);
  await recordAuditTrail(db, {
    entityType: "CAPA",
    entityId: created.id,
    action: "create",
    changes: { message: "CAPA opened from repeat NCRs", ncrIds: ids },
    performedBy: actorId,
  });
  await publishEvent(WORKFLOW_STREAM, { module: "capa", event: "escalated_from_repeat_ncr", entityId: created.id });
  return { capa: created, created: true };
}

/** Used by the list filter so a CAPA opened from a repeat still shows on every linked NCR. */
export function capaMatchesNcr(ncrId: number): ReturnType<typeof sql> {
  return sql`(${capa.ncrId} = ${ncrId} OR coalesce(${capa.repeatNcrIds}, '[]'::jsonb) @> ${JSON.stringify([ncrId])}::jsonb)`;
}
