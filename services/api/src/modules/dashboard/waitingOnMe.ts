/**
 * Actionable work for the signed-in person.
 * The caller only passes rows from modules this person can already read.
 * A module they cannot read is left out. Nothing here invents a module.
 */

import { showRecordNumber } from "../records/userRecordNumber.js";

const DAY_MS = 86_400_000;

export interface WaitingAccess {
  ncr: boolean;
  capa: boolean;
  fai: boolean;
  calibration: boolean;
  documents: boolean;
  training: boolean;
  audit: boolean;
}

export interface WaitingItem {
  id: string;
  module: string;
  number: string;
  description: string;
  assignedTo: string;
  dueDate: string | null;
  timing: string;
  daysLate: number | null;
  daysRemaining: number | null;
  status: string;
  href: string;
}

export interface WaitingPrefs {
  sort: "due" | "module" | "status";
  group: "none" | "module" | "status";
  module: string;
  timing: "all" | "late" | "due";
}

export const DEFAULT_WAITING_PREFS: WaitingPrefs = { sort: "due", group: "module", module: "all", timing: "all" };

export interface WaitingNcr {
  id: number;
  recordNumber?: string | null;
  title: string;
  status: string;
  assignedTo: number | null;
  dueDate: Date | string | null;
  siteId: number | null;
  isDeleted: boolean;
}

export interface WaitingCapa {
  id: number;
  recordNumber?: string | null;
  status: string;
  ownerId: number | null;
  verifiedBy: number | null;
  dueDate: Date | string | null;
  siteId: number | null;
  rootCause: string | null;
}

export interface WaitingFai {
  id: number;
  number: string | null;
  partNumber: string;
  status: string;
  assignedTo: number | null;
  supplierName: string;
}

export interface WaitingPull {
  id: number;
  partNumber: string;
  assignedTo: number | null;
  completedAt: Date | string | null;
}

export interface WaitingSource {
  id: number;
  partNumber: string;
  supplierName: string;
  status: string;
  nextDueDate: string | null;
}

export interface WaitingGage {
  id: number;
  name: string;
  serialNumber: string | null;
  dueStatus: string;
  nextDueAt: Date | string | null;
}

export interface WaitingApproval {
  id: number;
  workflowName: string;
  label: string;
  startedAt: Date | string | null;
}

export interface WaitingDocument {
  id: number;
  title: string;
  status: string;
  ownerId: number | null;
  assignedReviewerId: number | null;
}

export interface WaitingTraining {
  id: number;
  title: string;
  status: string;
  userId: number;
  dueAt: Date | string | null;
}

export interface WaitingAudit {
  id: number;
  name: string;
  status: string;
  auditorId: number | null;
  scheduledAt: Date | string | null;
}

export interface WaitingInput {
  now: Date;
  userId: number;
  access: WaitingAccess;
  names: Record<number, string | null>;
  siteIds: number[];
  ncrs: WaitingNcr[];
  capas: WaitingCapa[];
  faiRecords: WaitingFai[];
  pulls: WaitingPull[];
  sources: WaitingSource[];
  gages: WaitingGage[];
  approvals: WaitingApproval[];
  documents: WaitingDocument[];
  training: WaitingTraining[];
  audits: WaitingAudit[];
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function nameOf(names: Record<number, string | null>, id: number | null): string {
  if (id == null) return "Unassigned";
  const name = names[id];
  return name && name.trim() ? name.trim() : "Unassigned";
}

function onSite(siteId: number | null, siteIds: number[]): boolean {
  if (siteIds.length === 0) return false;
  if (siteId == null) return false;
  return siteIds.includes(siteId);
}

export function timingFor(due: Date | string | null | undefined, now: Date): { timing: string; daysLate: number | null; daysRemaining: number | null; dueDate: string | null } {
  const date = toDate(due);
  if (!date) return { timing: "No due date", daysLate: null, daysRemaining: null, dueDate: null };
  const days = Math.round((date.getTime() - now.getTime()) / DAY_MS);
  if (days < 0) {
    const late = Math.abs(days);
    return { timing: late === 1 ? "1 day late" : `${late} days late`, daysLate: late, daysRemaining: null, dueDate: date.toISOString() };
  }
  if (days === 0) return { timing: "Due today", daysLate: null, daysRemaining: 0, dueDate: date.toISOString() };
  return { timing: days === 1 ? "1 day remaining" : `${days} days remaining`, daysLate: null, daysRemaining: days, dueDate: date.toISOString() };
}

function item(partial: Omit<WaitingItem, "timing" | "daysLate" | "daysRemaining" | "dueDate"> & { due?: Date | string | null }, now: Date): WaitingItem {
  const when = timingFor(partial.due, now);
  return { ...partial, ...when };
}

export function buildWaitingItems(input: WaitingInput): WaitingItem[] {
  const { now, userId, access, names } = input;
  const items: WaitingItem[] = [];

  if (access.ncr) {
    for (const row of input.ncrs) {
      if (row.isDeleted || row.assignedTo !== userId || row.status === "closed") continue;
      if (!onSite(row.siteId, input.siteIds)) continue;
      items.push(item({
        id: `ncr-${row.id}`,
        module: "NCR",
        number: showRecordNumber(row.recordNumber),
        description: row.title,
        assignedTo: nameOf(names, row.assignedTo),
        status: row.status,
        href: `/ncr/${row.id}`,
        due: row.dueDate,
      }, now));
    }
  }

  if (access.capa) {
    for (const row of input.capas) {
      if (row.status === "closed") continue;
      const mine = row.ownerId === userId || (row.status === "verifying" && row.verifiedBy === userId);
      if (!mine) continue;
      if (!onSite(row.siteId, input.siteIds)) continue;
      items.push(item({
        id: `capa-${row.id}`,
        module: "CAPA",
        number: showRecordNumber(row.recordNumber),
        description: row.rootCause?.trim() || "CAPA",
        assignedTo: nameOf(names, row.ownerId),
        status: row.status,
        href: `/capa/${row.id}`,
        due: row.dueDate,
      }, now));
    }
  }

  if (access.calibration) {
    for (const row of input.gages) {
      if (row.dueStatus !== "overdue" && row.dueStatus !== "due_soon" && row.dueStatus !== "failed") continue;
      items.push(item({
        id: `gage-${row.id}`,
        module: "Calibration",
        number: row.serialNumber?.trim() || row.name,
        description: row.name,
        assignedTo: "Unassigned",
        status: row.dueStatus,
        href: `/calibration/${row.id}`,
        due: row.nextDueAt,
      }, now));
    }
  }

  for (const row of input.approvals) {
    if (isRetiredFirstArticleWork(row.workflowName, row.label)) continue;
    items.push(item({
      id: `approval-${row.id}`,
      module: "Approval",
      number: row.workflowName,
      description: row.label,
      assignedTo: nameOf(names, userId),
      status: "waiting",
      href: `/workflow/runs/${row.id}`,
      due: row.startedAt,
    }, now));
  }

  if (access.documents) {
    for (const row of input.documents) {
      const reviewer = row.assignedReviewerId === userId;
      const ownerReview = row.ownerId === userId && row.status === "in_review";
      if (!reviewer && !ownerReview) continue;
      items.push(item({
        id: `document-${row.id}`,
        module: "Document",
        number: row.title,
        description: reviewer ? "Waiting on your review" : "In review",
        assignedTo: nameOf(names, row.assignedReviewerId ?? row.ownerId),
        status: row.status,
        href: `/documents/${row.id}`,
      }, now));
    }
  }

  if (access.training) {
    for (const row of input.training) {
      if (row.userId !== userId || row.status === "completed") continue;
      items.push(item({
        id: `training-${row.id}`,
        module: "Training",
        number: row.title,
        description: row.title,
        assignedTo: nameOf(names, row.userId),
        status: row.status,
        href: `/training/${row.id}`,
        due: row.dueAt,
      }, now));
    }
  }

  if (access.audit) {
    for (const row of input.audits) {
      if (row.auditorId !== userId || row.status === "completed") continue;
      items.push(item({
        id: `audit-${row.id}`,
        module: "Audit",
        number: row.name,
        description: row.name,
        assignedTo: nameOf(names, row.auditorId),
        status: row.status,
        href: `/audits/${row.id}`,
        due: row.scheduledAt,
      }, now));
    }
  }

  return items;
}

export function sanitizeWaitingPrefs(value: unknown): WaitingPrefs {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const sort = raw.sort === "module" || raw.sort === "status" ? raw.sort : "due";
  const group = raw.group === "none" || raw.group === "status" ? raw.group : "module";
  const moduleName = typeof raw.module === "string" && raw.module.trim() ? raw.module.trim().slice(0, 40) : "all";
  const timing = raw.timing === "late" || raw.timing === "due" ? raw.timing : "all";
  return { sort, group, module: moduleName, timing };
}

export function presentWaitingList(items: WaitingItem[], prefs: WaitingPrefs): { groups: { key: string; items: WaitingItem[] }[] } {
  let rows = items;
  if (prefs.module !== "all") rows = rows.filter((row) => row.module === prefs.module);
  if (prefs.timing === "late") rows = rows.filter((row) => (row.daysLate ?? 0) > 0);
  if (prefs.timing === "due") rows = rows.filter((row) => row.dueDate != null);
  const sorted = [...rows].sort((a, b) => compareItems(a, b, prefs.sort));
  if (prefs.group === "none") return { groups: [{ key: "All", items: sorted }] };
  const keyOf = prefs.group === "status" ? (row: WaitingItem) => row.status : (row: WaitingItem) => row.module;
  const groups: { key: string; items: WaitingItem[] }[] = [];
  for (const row of sorted) {
    const key = keyOf(row);
    const last = groups[groups.length - 1];
    if (last && last.key === key) last.items.push(row);
    else groups.push({ key, items: [row] });
  }
  return { groups };
}

/** Home must not offer the retired First Article module, including CSA First Article Inspection approvals. */
export function isRetiredFirstArticleWork(workflowName: string, label = ""): boolean {
  const text = `${workflowName} ${label}`.toLowerCase();
  return text.includes("first article") || text.includes("csa fai") || text.includes("fuel pump module fai");
}

function compareItems(a: WaitingItem, b: WaitingItem, sort: WaitingPrefs["sort"]): number {
  if (sort === "module") return a.module.localeCompare(b.module) || a.number.localeCompare(b.number);
  if (sort === "status") return a.status.localeCompare(b.status) || a.number.localeCompare(b.number);
  const aLate = a.daysLate ?? (a.dueDate == null ? -1 : 0);
  const bLate = b.daysLate ?? (b.dueDate == null ? -1 : 0);
  if (aLate !== bLate) return bLate - aLate;
  if (a.dueDate == null && b.dueDate == null) return a.number.localeCompare(b.number);
  if (a.dueDate == null) return 1;
  if (b.dueDate == null) return -1;
  return a.dueDate.localeCompare(b.dueDate);
}
