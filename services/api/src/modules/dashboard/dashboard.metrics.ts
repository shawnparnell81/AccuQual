/**
 * Turns already-loaded records into the signed-in dashboard.
 * Pure: no database, no sample numbers. A module the caller cannot read
 * comes back as `access: false` and null counts. Modules that do not exist
 * yet (deviations, APQP gates, a defect-cause field on issues) are marked
 * unavailable instead of being filled in.
 */

import { showRecordNumber } from "../records/userRecordNumber.js";

const DAY_MS = 86_400_000;
const TREND_WEEKS = 12;
const SPARK_WEEKS = 8;
const PARETO_DAYS = 180;
const STUCK_ISSUE_DAYS = 30;
const LIST_LIMIT = 12;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const AGING = ["0–7d", "8–30d", "31–60d", "60d+"];

export interface SiteRef {
  id: number;
  name: string;
  code: string;
  retired?: boolean;
}

export interface DashNcr {
  id: number;
  recordNumber?: string | null;
  siteId: number | null;
  title: string;
  status: string;
  severity: string | null;
  assignedTo: number | null;
  dueDate: Date | string | null;
  closedAt: Date | string | null;
  createdAt: Date | string | null;
  rootCause: string | null;
  isDeleted: boolean;
}

export interface DashCapa {
  id: number;
  recordNumber?: string | null;
  siteId: number | null;
  ncrId: number | null;
  status: string;
  ownerId: number | null;
  dueDate: Date | string | null;
  closedAt: Date | string | null;
  createdAt: Date | string | null;
  actionPlan: string | null;
  rootCause: string | null;
}

export interface DashDocument {
  id: number;
  title: string;
  status: string;
  ownerId: number | null;
  expirationDate: Date | string | null;
  expirationWarningDays: number;
  revisionCode: string | null;
  isDeleted: boolean;
}

export interface DashAssignment {
  id: number;
  courseId: number;
  courseTitle: string | null;
  userId: number;
  status: string;
  dueAt: Date | string | null;
}

export interface DashEquipment {
  id: number;
  name: string;
  dueStatus: "failed" | "overdue" | "due_soon" | "upcoming" | "current" | "uncalibrated";
  nextDueAt: Date | string | null;
}

export interface DashAudit {
  id: number;
  recordNumber?: string | null;
  siteId: number | null;
  name: string;
  status: string;
  auditorId: number | null;
  scheduledAt: Date | string | null;
}

export interface DashAuditItem {
  id: number;
  auditId: number;
  severity: string | null;
  finding: string | null;
}

export interface DashChange {
  id: number;
  title: string;
  status: string;
}

export interface DashPpap {
  id: number;
  partNumber: string;
  partName: string | null;
  status: string;
}

export interface DashScar {
  id: number;
  scarNumber?: string | null;
  supplierName: string;
  status: string;
  responseDueDate: Date | string | null;
  containmentPlan: string | null;
  why1: string | null;
  supplierRepSignature: string | null;
  createdBy: number | null;
}

export interface DashActivity {
  id: number;
  entityType: string;
  entityId: number;
  action: string;
  title: string | null;
  performedBy: number | null;
  createdAt: Date | string | null;
  siteId: number | null;
}

export interface DashboardSource {
  now: Date;
  userId: number;
  /** Plants the numbers at the top are for. */
  scope: { allPlants: boolean; siteIds: number[]; sites: SiteRef[] };
  /** Every plant this person may see, used for the comparison. */
  comparisonSites: SiteRef[];
  access: {
    ncr: boolean;
    capa: boolean;
    documents: boolean;
    training: boolean;
    audit: boolean;
    calibration: boolean;
    change: boolean;
    ppap: boolean;
    scar: boolean;
    approveDocuments: boolean;
    recordCalibration: boolean;
  };
  ncrs: DashNcr[];
  capas: DashCapa[];
  documents: DashDocument[];
  assignments: DashAssignment[];
  userSites: { userId: number; siteId: number }[];
  equipment: DashEquipment[];
  audits: DashAudit[];
  auditItems: DashAuditItem[];
  changes: DashChange[];
  ppaps: DashPpap[];
  scars: DashScar[];
  activity: DashActivity[];
  names: Record<number, string | null>;
  /** True when a list hit the safety cap, so counts may leave older rows out. */
  partial: boolean;
}

export interface CountKpi {
  access: boolean;
  value: number | null;
}

export interface DashboardOverview {
  partial: boolean;
  scope: { allPlants: boolean; label: string; siteIds: number[] };
  kpis: {
    openIssues: CountKpi & { highCritical: number | null; spark: number[] };
    overdueFixes: CountKpi & { openTotal: number | null };
    docsDue: CountKpi & { waitingApproval: number | null; companyWide: true };
    training: { access: boolean; percent: number | null; overdue: number | null; assigned: number | null };
    calibration: CountKpi & { overdue: number | null; failed: number | null; dueSoon: number | null; companyWide: true };
    auditFindings: CountKpi & { total: number | null };
  };
  engineering: {
    changes: { access: boolean; open: number | null; inReview: number | null; approved: number | null; companyWide: true };
    ppap: { access: boolean; pending: number | null; awaitingCustomer: number | null; companyWide: true };
    deviations: { available: false; reason: string };
    apqp: { available: false; reason: string };
  };
  trend: { access: boolean; labels: string[]; opened: number[]; closed: number[] };
  pareto: { access: boolean; basis: "root-cause"; items: { label: string; value: number }[] };
  aging: { categories: string[]; issues: number[] | null; fixes: number[] | null };
  tasks: DashListItem[];
  stuck: DashStuckItem[];
  plants: {
    id: number;
    name: string;
    code: string;
    openIssues: number | null;
    lateFixes: number | null;
    trainingPercent: number | null;
    trainingOverdue: number | null;
  }[];
  /** Gages have no plant column, so they are left out of the comparison on purpose. */
  gagesByPlant: false;
  activity: { id: number; at: string | null; text: string; href: string | null; by: string }[];
}

export interface DashListItem {
  id: string;
  href: string;
  ref: string;
  title: string;
  kind: string;
  due: string | null;
}

export interface DashStuckItem {
  id: string;
  href: string;
  ref: string;
  title: string;
  why: string;
  tone: "warn" | "bad";
  who: string;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysUntil(value: Date | string | null | undefined, now: Date): number | null {
  const date = toDate(value);
  if (!date) return null;
  return Math.floor((date.getTime() - now.getTime()) / DAY_MS);
}

function ageDays(value: Date | string | null | undefined, now: Date): number | null {
  const days = daysUntil(value, now);
  return days == null ? null : -days;
}

function iso(value: Date | string | null | undefined): string | null {
  const date = toDate(value);
  return date ? date.toISOString() : null;
}

function shortDate(date: Date): string {
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}`;
}

function inIds(siteId: number | null, siteIds: number[]): boolean {
  return siteId != null && siteIds.includes(siteId);
}

function personName(names: Record<number, string | null>, id: number | null): string {
  if (id == null) return "Unassigned";
  const name = names[id];
  if (name && name.trim()) return name.trim();
  return `Person #${id}`;
}

function agingBucket(days: number): number {
  if (days <= 7) return 0;
  if (days <= 30) return 1;
  if (days <= 60) return 2;
  return 3;
}

function weekly(now: Date): { labels: string[]; indexOf: (value: Date | string | null | undefined) => number | null } {
  const labels: string[] = [];
  for (let w = TREND_WEEKS - 1; w >= 0; w--) labels.push(shortDate(new Date(now.getTime() - w * 7 * DAY_MS)));
  return {
    labels,
    indexOf(value) {
      const age = ageDays(value, now);
      if (age == null || age < 0) return null;
      const week = Math.floor(age / 7);
      if (week < 0 || week >= TREND_WEEKS) return null;
      return TREND_WEEKS - 1 - week;
    },
  };
}

function scopeLabel(scope: DashboardSource["scope"]): string {
  if (scope.allPlants) {
    if (scope.sites.length > 1) return "All plants";
    return scope.sites[0]?.name ?? "All plants";
  }
  if (scope.sites.length === 1) return scope.sites[0]!.name;
  return "This plant";
}

function usersAt(userSites: DashboardSource["userSites"], siteIds: number[]): Set<number> {
  const wanted = new Set(siteIds);
  const ids = new Set<number>();
  for (const row of userSites) if (wanted.has(row.siteId)) ids.add(row.userId);
  return ids;
}

function trainingOf(assignments: DashAssignment[], userIds: Set<number> | null, now: Date) {
  const rows = userIds ? assignments.filter((row) => userIds.has(row.userId)) : assignments;
  const overdue = rows.filter((row) => row.status !== "completed" && (row.status === "overdue" || (daysUntil(row.dueAt, now) ?? 0) < 0 && row.dueAt != null)).length;
  const completed = rows.filter((row) => row.status === "completed").length;
  return {
    assigned: rows.length,
    overdue,
    percent: rows.length === 0 ? null : Math.round((completed / rows.length) * 100),
  };
}

function docIsDue(doc: DashDocument, now: Date): boolean {
  if (doc.isDeleted || doc.status === "obsolete") return false;
  if (doc.status === "in_review") return true;
  const days = daysUntil(doc.expirationDate, now);
  if (days == null) return false;
  return days <= doc.expirationWarningDays;
}

type ItemClass = "finding" | "observation";

function classifyItem(item: DashAuditItem): ItemClass | null {
  const severity = (item.severity ?? "").toLowerCase();
  if (severity === "observation") return "observation";
  if (severity === "minor" || severity === "major" || severity === "critical") return "finding";
  if ((item.finding ?? "").trim()) return "finding";
  return null;
}

function blankCounts(): number[] {
  return [0, 0, 0, 0];
}

const ACTIVITY_META: Record<string, { label: string; href: (id: number) => string; access: keyof DashboardSource["access"] }> = {
  NCR: { label: "Issue", href: (id) => `/ncr/${id}`, access: "ncr" },
  CAPA: { label: "Fix", href: (id) => `/capa/${id}`, access: "capa" },
  Audit: { label: "Audit", href: (id) => `/audits/${id}`, access: "audit" },
  Document: { label: "Document", href: (id) => `/documents/${id}`, access: "documents" },
  Equipment: { label: "Gage", href: (id) => `/calibration/${id}`, access: "calibration" },
  "Change request": { label: "Change request", href: (id) => `/change/${id}`, access: "change" },
  "PPAP package": { label: "PPAP", href: (id) => `/ppap/${id}`, access: "ppap" },
};

function activityText(entry: DashActivity, meta: { label: string }): string {
  const verb = entry.action === "create" ? "added" : entry.action === "delete" ? "removed" : entry.action === "status_change" ? "updated" : "changed";
  return entry.title ? `${meta.label} ${verb}: ${entry.title}` : `${meta.label} #${entry.entityId} ${verb}`;
}

/** A deleted record stays in the audit log. The dashboard must not link to it. */
function activityRecordExists(source: DashboardSource, entry: DashActivity): boolean {
  const id = entry.entityId;
  if (entry.entityType === "NCR") return source.ncrs.some((row) => row.id === id && !row.isDeleted);
  if (entry.entityType === "CAPA") return source.capas.some((row) => row.id === id);
  if (entry.entityType === "Audit") return source.audits.some((row) => row.id === id);
  if (entry.entityType === "Document") return source.documents.some((row) => row.id === id && !row.isDeleted);
  if (entry.entityType === "Equipment") return source.equipment.some((row) => row.id === id);
  if (entry.entityType === "Change request") return source.changes.some((row) => row.id === id);
  if (entry.entityType === "PPAP package") return source.ppaps.some((row) => row.id === id);
  return false;
}

function capaTitle(capa: DashCapa): string {
  const text = capa.actionPlan?.trim() || capa.rootCause?.trim();
  if (text) return text;
  return capa.ncrId ? "Fix for a linked issue" : "Fix";
}

export function buildDashboardOverview(source: DashboardSource): DashboardOverview {
  const { now, access, scope } = source;
  const siteIds = scope.siteIds;
  const ncrs = access.ncr ? source.ncrs.filter((row) => !row.isDeleted && inIds(row.siteId, siteIds)) : [];
  const capas = access.capa ? source.capas.filter((row) => inIds(row.siteId, siteIds)) : [];
  const audits = access.audit ? source.audits.filter((row) => inIds(row.siteId, siteIds)) : [];
  const openNcrs = ncrs.filter((row) => row.status !== "closed");
  const openCapas = capas.filter((row) => row.status !== "closed");
  const lateCapas = openCapas.filter((row) => (daysUntil(row.dueDate, now) ?? 0) < 0 && row.dueDate != null);

  const weeks = weekly(now);
  const opened = new Array<number>(TREND_WEEKS).fill(0);
  const closed = new Array<number>(TREND_WEEKS).fill(0);
  if (access.ncr) {
    for (const row of ncrs) {
      const openedAt = weeks.indexOf(row.createdAt);
      if (openedAt != null) opened[openedAt] = (opened[openedAt] ?? 0) + 1;
      const closedAt = weeks.indexOf(row.closedAt);
      if (closedAt != null) closed[closedAt] = (closed[closedAt] ?? 0) + 1;
    }
  }

  const docs = access.documents ? source.documents.filter((row) => !row.isDeleted) : [];
  const docsDue = docs.filter((row) => docIsDue(row, now));
  const waitingApproval = docs.filter((row) => row.status === "in_review").length;

  const training = access.training ? trainingOf(source.assignments, scope.allPlants ? null : usersAt(source.userSites, siteIds), now) : null;

  const equipment = access.calibration ? source.equipment : [];
  const calFailed = equipment.filter((row) => row.dueStatus === "failed").length;
  const calOverdue = equipment.filter((row) => row.dueStatus === "overdue").length;
  const calDueSoon = equipment.filter((row) => row.dueStatus === "due_soon").length;

  const auditById = new Map(audits.map((row) => [row.id, row]));
  let findings = 0;
  let observations = 0;
  if (access.audit) {
    for (const item of source.auditItems) {
      if (!auditById.has(item.auditId)) continue;
      const kind = classifyItem(item);
      if (kind === "finding") findings += 1;
      else if (kind === "observation") observations += 1;
    }
  }

  const changes = access.change ? source.changes : [];
  const openChanges = changes.filter((row) => row.status !== "implemented" && row.status !== "rejected");
  const ppaps = access.ppap ? source.ppaps : [];
  const pendingPpap = ppaps.filter((row) => row.status === "open" || row.status === "submitted");

  const paretoCounts = new Map<string, number>();
  if (access.ncr) {
    for (const row of ncrs) {
      const age = ageDays(row.createdAt, now);
      const cause = row.rootCause?.trim().replace(/\s+/g, " ") ?? "";
      if (!cause || age == null || age < 0 || age > PARETO_DAYS) continue;
      paretoCounts.set(cause, (paretoCounts.get(cause) ?? 0) + 1);
    }
  }
  const paretoItems = [...paretoCounts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
    .slice(0, 8);

  const issueAging = access.ncr ? blankCounts() : null;
  const fixAging = access.capa ? blankCounts() : null;
  if (issueAging) {
    for (const row of openNcrs) {
      const age = ageDays(row.createdAt, now);
      if (age != null && age >= 0) {
        const bucket = agingBucket(age);
        issueAging[bucket] = (issueAging[bucket] ?? 0) + 1;
      }
    }
  }
  if (fixAging) {
    for (const row of openCapas) {
      const age = ageDays(row.createdAt, now);
      if (age != null && age >= 0) {
        const bucket = agingBucket(age);
        fixAging[bucket] = (fixAging[bucket] ?? 0) + 1;
      }
    }
  }

  const tasks: DashListItem[] = [];
  if (access.ncr) {
    for (const row of openNcrs.filter((item) => item.assignedTo === source.userId)) {
      tasks.push({ id: `ncr-${row.id}`, href: `/ncr/${row.id}`, ref: showRecordNumber(row.recordNumber), title: row.title, kind: "Issue assigned to you", due: iso(row.dueDate) });
    }
  }
  if (access.capa) {
    for (const row of openCapas.filter((item) => item.ownerId === source.userId)) {
      tasks.push({ id: `capa-${row.id}`, href: `/capa/${row.id}`, ref: showRecordNumber(row.recordNumber), title: capaTitle(row), kind: "Fix you own", due: iso(row.dueDate) });
    }
  }
  if (access.approveDocuments) {
    for (const row of docs.filter((item) => item.status === "in_review")) {
      const rev = row.revisionCode?.trim();
      tasks.push({
        id: `doc-${row.id}`,
        href: `/documents/${row.id}`,
        ref: row.revisionCode?.trim() || "",
        title: rev ? `Approve ${rev} — ${row.title}` : `Approve — ${row.title}`,
        kind: "Waiting for your sign-off",
        due: null,
      });
    }
  }
  if (access.training) {
    for (const row of source.assignments.filter((item) => item.userId === source.userId && item.status !== "completed")) {
      const late = row.status === "overdue" || ((daysUntil(row.dueAt, now) ?? 0) < 0 && row.dueAt != null);
      if (!late && row.status !== "assigned" && row.status !== "in_progress") continue;
      tasks.push({
        id: `trn-${row.id}`,
        href: `/training/${row.courseId}`,
        ref: "",
        title: row.courseTitle?.trim() || `Course #${row.courseId}`,
        kind: "Training assigned to you",
        due: iso(row.dueAt),
      });
    }
  }
  if (access.audit) {
    for (const row of audits.filter((item) => item.auditorId === source.userId && item.status !== "completed")) {
      tasks.push({
        id: `aud-${row.id}`,
        href: `/audits/${row.id}`,
        ref: showRecordNumber(row.recordNumber),
        title: row.name,
        kind: row.status === "in_progress" ? "Audit in progress" : "Audit you lead",
        due: iso(row.scheduledAt),
      });
    }
  }
  if (access.recordCalibration) {
    for (const row of equipment.filter((item) => item.dueStatus === "overdue" || item.dueStatus === "failed")) {
      tasks.push({
        id: `eq-${row.id}`,
        href: `/calibration/${row.id}`,
        ref: "",
        title: `${row.name} calibration ${row.dueStatus === "failed" ? "failed" : "overdue"}`,
        kind: "Gage overdue",
        due: iso(row.nextDueAt),
      });
    }
  }
  tasks.sort((a, b) => {
    const left = a.due ? new Date(a.due).getTime() : Number.POSITIVE_INFINITY;
    const right = b.due ? new Date(b.due).getTime() : Number.POSITIVE_INFINITY;
    return left - right;
  });

  const stuck: DashStuckItem[] = [];
  if (access.ncr) {
    for (const row of openNcrs) {
      const age = ageDays(row.createdAt, now);
      if (age == null || age <= STUCK_ISSUE_DAYS) continue;
      stuck.push({
        id: `ncr-${row.id}`,
        href: `/ncr/${row.id}`,
        ref: showRecordNumber(row.recordNumber),
        title: row.title,
        why: `${row.status.replace(/_/g, " ")} for ${age} days`,
        tone: "warn",
        who: personName(source.names, row.assignedTo),
      });
    }
  }
  if (access.capa) {
    for (const row of lateCapas) {
      const late = -(daysUntil(row.dueDate, now) ?? 0);
      stuck.push({
        id: `capa-${row.id}`,
        href: `/capa/${row.id}`,
        ref: showRecordNumber(row.recordNumber),
        title: capaTitle(row),
        why: `Late by ${late}d`,
        tone: "bad",
        who: personName(source.names, row.ownerId),
      });
    }
  }
  if (access.documents) {
    for (const row of docs.filter((item) => item.status === "in_review")) {
      stuck.push({
        id: `doc-${row.id}`,
        href: `/documents/${row.id}`,
        ref: row.revisionCode?.trim() || "",
        title: row.title,
        why: "Waiting for approval",
        tone: "warn",
        who: personName(source.names, row.ownerId),
      });
    }
  }
  if (access.scar) {
    for (const row of source.scars) {
      const late = daysUntil(row.responseDueDate, now);
      const answered = Boolean(row.supplierRepSignature?.trim() || row.containmentPlan?.trim() || row.why1?.trim());
      if (row.status !== "open" || late == null || late >= 0 || answered) continue;
      stuck.push({
        id: `scar-${row.id}`,
        href: `/scar-forms/${row.id}`,
        ref: showRecordNumber(row.scarNumber),
        title: `${row.supplierName} — no response`,
        why: `Response late by ${-late}d`,
        tone: "bad",
        who: personName(source.names, row.createdBy),
      });
    }
  }

  const plants = source.comparisonSites.map((site) => {
    const siteNcrs = access.ncr ? source.ncrs.filter((row) => !row.isDeleted && row.siteId === site.id && row.status !== "closed") : [];
    const siteCapas = access.capa ? source.capas.filter((row) => row.siteId === site.id && row.status !== "closed" && row.dueDate != null && (daysUntil(row.dueDate, now) ?? 0) < 0) : [];
    const train = access.training ? trainingOf(source.assignments, usersAt(source.userSites, [site.id]), now) : null;
    return {
      id: site.id,
      name: site.name,
      code: site.code,
      openIssues: access.ncr ? siteNcrs.length : null,
      lateFixes: access.capa ? siteCapas.length : null,
      trainingPercent: train ? train.percent : null,
      trainingOverdue: train ? train.overdue : null,
    };
  });

  const activity = source.activity
    .filter((entry) => {
      const meta = ACTIVITY_META[entry.entityType];
      if (!meta || !access[meta.access]) return false;
      if (entry.siteId == null) return true;
      return inIds(entry.siteId, siteIds);
    })
    .slice(0, 8)
    .map((entry) => {
      const meta = ACTIVITY_META[entry.entityType]!;
      return {
        id: entry.id,
        at: iso(entry.createdAt),
        text: activityText(entry, meta),
        href: activityRecordExists(source, entry) ? meta.href(entry.entityId) : null,
        by: personName(source.names, entry.performedBy),
      };
    });

  return {
    partial: source.partial,
    scope: { allPlants: scope.allPlants, label: scopeLabel(scope), siteIds },
    kpis: {
      openIssues: {
        access: access.ncr,
        value: access.ncr ? openNcrs.length : null,
        highCritical: access.ncr ? openNcrs.filter((row) => row.severity === "high" || row.severity === "critical").length : null,
        spark: access.ncr ? opened.slice(-SPARK_WEEKS) : [],
      },
      overdueFixes: {
        access: access.capa,
        value: access.capa ? lateCapas.length : null,
        openTotal: access.capa ? openCapas.length : null,
      },
      docsDue: {
        access: access.documents,
        value: access.documents ? docsDue.length : null,
        waitingApproval: access.documents ? waitingApproval : null,
        companyWide: true,
      },
      training: {
        access: access.training,
        percent: training?.percent ?? null,
        overdue: training?.overdue ?? null,
        assigned: training?.assigned ?? null,
      },
      calibration: {
        access: access.calibration,
        value: access.calibration ? calFailed + calOverdue + calDueSoon : null,
        overdue: access.calibration ? calOverdue : null,
        failed: access.calibration ? calFailed : null,
        dueSoon: access.calibration ? calDueSoon : null,
        companyWide: true,
      },
      auditFindings: {
        access: access.audit,
        value: access.audit ? findings : null,
        total: access.audit ? findings + observations : null,
      },
    },
    engineering: {
      changes: {
        access: access.change,
        open: access.change ? openChanges.length : null,
        inReview: access.change ? openChanges.filter((row) => row.status === "under_review").length : null,
        approved: access.change ? openChanges.filter((row) => row.status === "approved").length : null,
        companyWide: true,
      },
      ppap: {
        access: access.ppap,
        pending: access.ppap ? pendingPpap.length : null,
        awaitingCustomer: access.ppap ? pendingPpap.filter((row) => row.status === "submitted").length : null,
        companyWide: true,
      },
      deviations: { available: false, reason: "Deviations aren't tracked yet." },
      apqp: { available: false, reason: "APQP gates aren't tracked yet." },
    },
    trend: { access: access.ncr, labels: weeks.labels, opened: access.ncr ? opened : [], closed: access.ncr ? closed : [] },
    pareto: { access: access.ncr, basis: "root-cause", items: paretoItems },
    aging: { categories: AGING, issues: issueAging, fixes: fixAging },
    tasks: tasks.slice(0, LIST_LIMIT),
    stuck: stuck.slice(0, LIST_LIMIT),
    plants,
    gagesByPlant: false,
    activity,
  };
}
