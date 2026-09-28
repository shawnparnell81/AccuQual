import { appRecordUrl } from "../../lib/recordLink.js";
import { isFullAccessRole, isReviewerRole } from "../roles/roleAccess.js";

const EXECUTIVE_APPROVER_STEPS = new Set(["quality_manager", "president", "vice_president"]);

/** Defaults an admin can change. Remind 3 days before, on the due date, and escalate after 7 days overdue. */
export const DEFAULT_QUALITY_AUTOMATION = {
  remindDaysBeforeDue: 3,
  escalateAfterDaysOverdue: 7,
  stuckDays: 14,
  approvalStuckDays: 3,
  repeatNcrWindowDays: 90,
  repeatNcrThreshold: 3,
} as const;

export type QualityAutomationSettings = { -readonly [K in keyof typeof DEFAULT_QUALITY_AUTOMATION]: number };

export function resolveQualityAutomationSettings(raw: Partial<QualityAutomationSettings> | null | undefined): QualityAutomationSettings {
  const resolved: QualityAutomationSettings = { ...DEFAULT_QUALITY_AUTOMATION };
  if (!raw) return resolved;
  for (const key of Object.keys(DEFAULT_QUALITY_AUTOMATION) as (keyof QualityAutomationSettings)[]) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) resolved[key] = value;
  }
  return resolved;
}

export function safeTimeZone(timeZone: string | undefined | null): string {
  if (!timeZone) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return timeZone;
  } catch {
    return "UTC";
  }
}

const DAY_MS = 86_400_000;

/** Calendar date in `timeZone` as YYYY-MM-DD. */
export function calendarDay(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function dayIndex(date: Date, timeZone: string): number {
  const [year, month, day] = calendarDay(date, timeZone).split("-").map(Number);
  return Math.floor(Date.UTC(year!, (month ?? 1) - 1, day) / DAY_MS);
}

/** Whole calendar days from `now` until `due`. Negative means overdue. */
export function calendarDaysUntil(due: Date, now: Date, timeZone: string): number {
  return dayIndex(due, timeZone) - dayIndex(now, timeZone);
}

/** Whole calendar days from `then` to `now` (0 if `then` is later). */
export function ageInCalendarDays(then: Date, now: Date, timeZone: string): number {
  return Math.max(0, dayIndex(now, timeZone) - dayIndex(then, timeZone));
}

export type DueKind = "due_soon" | "due_today" | "overdue" | "escalated";

/**
 * The strongest state for a due date. Escalation replaces a plain overdue
 * notice once the record is past the configured number of days.
 */
export function classifyDue(
  due: Date,
  now: Date,
  settings: Pick<QualityAutomationSettings, "remindDaysBeforeDue" | "escalateAfterDaysOverdue">,
  timeZone: string,
): DueKind | null {
  const days = calendarDaysUntil(due, now, timeZone);
  if (days < 0) return -days >= settings.escalateAfterDaysOverdue ? "escalated" : "overdue";
  if (days === 0) return "due_today";
  if (days <= settings.remindDaysBeforeDue) return "due_soon";
  return null;
}

export interface EscalationPerson {
  id: number;
  email: string;
  isActive: boolean;
  managerId: number | null;
  roleName: string | null;
  department: string | null;
}

function uniqueEmails(rows: { email: string }[]): string[] {
  return [...new Set(rows.map((row) => row.email).filter(Boolean))];
}

/**
 * Escalation goes to the owner's manager when one is set and still active.
 * Otherwise it goes to quality managers, then to anyone in Quality.
 */
export function escalationRecipients(ownerId: number | null, people: EscalationPerson[]): string[] {
  const active = people.filter((person) => person.isActive && person.email);
  const owner = ownerId == null ? undefined : people.find((person) => person.id === ownerId);
  if (owner?.managerId != null) {
    const manager = active.find((person) => person.id === owner.managerId);
    if (manager) return [manager.email];
  }
  const managers = active.filter((person) => person.roleName === "quality_manager");
  if (managers.length > 0) return uniqueEmails(managers);
  return uniqueEmails(active.filter((person) => person.department === "quality"));
}

export function ownerEmail(ownerId: number | null, people: EscalationPerson[]): string | null {
  if (ownerId == null) return null;
  const owner = people.find((person) => person.id === ownerId && person.isActive && person.email);
  return owner?.email ?? null;
}

export interface ApprovalPending {
  approverRole?: string;
  approverDepartment?: string;
}

/** Same rule the workflow approval inbox uses: full access, the named role, an executive approver on an executive step, or the named department. */
export function canDecideApproval(person: Pick<EscalationPerson, "roleName" | "department">, pending: ApprovalPending): boolean {
  if (isFullAccessRole(person.roleName)) return true;
  if (pending.approverRole && person.roleName === pending.approverRole) return true;
  if (isReviewerRole(person.roleName) && pending.approverRole != null && EXECUTIVE_APPROVER_STEPS.has(pending.approverRole)) return true;
  if (pending.approverDepartment && person.department === pending.approverDepartment) return true;
  return false;
}

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "to", "for", "in", "on", "with", "is", "was", "are", "this", "that", "from", "by", "at", "as", "be", "it", "not", "no", "were", "has", "had", "have", "but", "its", "into", "per", "via",
]);

export function descriptionTokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length >= 3 && !STOP_WORDS.has(token));
}

/** Jaccard overlap of meaningful words. Short notes never count as similar on their own. */
export function descriptionsSimilar(left: string, right: string): boolean {
  const a = new Set(descriptionTokens(left));
  const b = new Set(descriptionTokens(right));
  if (a.size < 3 || b.size < 3) return false;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const union = a.size + b.size - shared;
  return union > 0 && shared / union >= 0.5;
}

export interface RepeatSignals {
  id: number;
  createdAt: Date;
  part: string | null;
  supplierId: number | null;
  defectCode: string | null;
  description: string;
  title: string;
}

/**
 * A repeat is the same part, or the same supplier and defect code, or a
 * similar description. Supplier alone, or a defect category alone, is too
 * broad (every incoming lot from one supplier would look like a repeat).
 */
export function sameIssue(left: RepeatSignals, right: RepeatSignals): boolean {
  if (left.id === right.id) return false;
  if (left.part && left.part === right.part) return true;
  if (left.supplierId != null && left.supplierId === right.supplierId && left.defectCode && left.defectCode === right.defectCode) return true;
  return descriptionsSimilar(left.description, right.description);
}

export function findRepeatCluster(records: RepeatSignals[], subjectId: number, windowDays: number, threshold: number, now: Date): RepeatSignals[] {
  const subject = records.find((record) => record.id === subjectId);
  if (!subject) return [];
  const since = now.getTime() - windowDays * DAY_MS;
  const peers = records.filter((record) => record.id !== subjectId && record.createdAt.getTime() >= since && sameIssue(subject, record));
  const cluster = [subject, ...peers].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || b.id - a.id);
  return cluster.length >= threshold ? cluster : [];
}

/** Part number as typed on the NCR form, before any " / description" suffix. */
export function normalizePart(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const head = raw.split("/")[0]?.trim().toLowerCase().replace(/\s+/g, " ") ?? "";
  return head.length >= 2 ? head : null;
}

/** Checkbox groups on the NCR form store `{ Column: { "Dimensional": true } }` on one or more rows. */
export function checkedOptions(value: unknown, columnKey: string): string[] {
  const rows = Array.isArray(value) ? value : value && typeof value === "object" ? [value] : [];
  const selected: string[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;
    const cell = record[columnKey] ?? record;
    if (!cell || typeof cell !== "object" || Array.isArray(cell)) continue;
    for (const [label, on] of Object.entries(cell as Record<string, unknown>)) {
      if (on === true) selected.push(label);
    }
  }
  return selected;
}

export function signalsFromNcr(input: {
  id: number;
  createdAt: Date;
  supplierId: number | null;
  title: string | null;
  description: string | null;
  form: Record<string, unknown> | null;
  partNumbers: string[];
}): RepeatSignals {
  const form = input.form ?? {};
  const partFromForm = typeof form.partNumberDescription === "string" ? normalizePart(form.partNumberDescription) : null;
  const partFromHold = input.partNumbers.map((part) => normalizePart(part)).find((part): part is string => !!part) ?? null;
  const categories = checkedOptions(form.nonconformanceCategory, "category").sort();
  const formDescription = typeof form.nonconformanceDescription === "string" ? form.nonconformanceDescription : "";
  const description = [input.title, input.description, formDescription].filter((part) => !!part && part.trim()).join(" ");
  return {
    id: input.id,
    createdAt: input.createdAt,
    part: partFromForm ?? partFromHold,
    supplierId: input.supplierId,
    defectCode: categories.length > 0 ? categories.join(", ") : null,
    description,
    title: input.title?.trim() || `NCR #${input.id}`,
  };
}

/** An 8D is finished once D8 has been written. There is no separate closed flag on the row. */
export function eightDIsClosed(data: Record<string, unknown> | null | undefined): boolean {
  const closure = data?.d8_closure;
  if (typeof closure === "string" && closure.trim().length > 0) return true;
  const recognition = data?.recognition;
  return typeof recognition === "string" && recognition.trim().length > 0;
}

/** Optional target/due text stored inside the 8D step data. The table itself has no due-date column. */
export function eightDDueDate(data: Record<string, unknown> | null | undefined): Date | null {
  if (!data) return null;
  for (const [key, value] of Object.entries(data)) {
    if (!/due|target/i.test(key) || typeof value !== "string") continue;
    if (!/^\d{4}-\d{2}-\d{2}/.test(value)) continue;
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

export interface EmailItem {
  label: string;
  detail: string;
  href: string;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Plain text plus a simple HTML message. Each record is a link to the app. */
export function renderNoticeEmail(input: { heading: string; intro: string; items: EmailItem[] }): { text: string; html: string } {
  const lines = input.items.map((item) => `- ${item.label}${item.detail ? ` — ${item.detail}` : ""}\n  ${item.href}`);
  const text = `${input.heading}\n\n${input.intro}\n\n${lines.join("\n")}\n`;
  const rows = input.items
    .map(
      (item) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid #e6e8ee;"><a href="${escapeHtml(item.href)}" style="color:#0b3a66;font-weight:600;text-decoration:none;">${escapeHtml(item.label)}</a><div style="color:#526072;font-size:13px;margin-top:4px;">${escapeHtml(item.detail)}</div></td><td style="padding:12px 0;border-bottom:1px solid #e6e8ee;text-align:right;white-space:nowrap;"><a href="${escapeHtml(item.href)}" style="color:#0b3a66;">Open</a></td></tr>`,
    )
    .join("");
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f6f8;font-family:Inter,Segoe UI,Helvetica,Arial,sans-serif;color:#1c2430;"><div style="max-width:560px;margin:24px auto;background:#ffffff;border:1px solid #e6e8ee;border-radius:12px;overflow:hidden;"><div style="background:#0b3a66;color:#ffffff;padding:16px 20px;font-size:14px;letter-spacing:0.04em;">AccuQual</div><div style="padding:20px;"><h1 style="font-size:20px;margin:0 0 8px;">${escapeHtml(input.heading)}</h1><p style="margin:0 0 16px;color:#526072;font-size:14px;line-height:1.5;">${escapeHtml(input.intro)}</p><table style="width:100%;border-collapse:collapse;">${rows}</table></div></div></body></html>`;
  return { text, html };
}

export function recordHref(frontendUrl: string, path: string): string {
  return appRecordUrl(frontendUrl, path);
}

export function noticeCopy(kind: string, count: number): { heading: string; intro: string; subject: string } {
  const noun = count === 1 ? "record" : "records";
  switch (kind) {
    case "due_soon":
      return { heading: "Coming due", intro: "These records are due soon. Open each one and update it before the date.", subject: count === 1 ? "Due soon" : `Due soon: ${count} ${noun}` };
    case "due_today":
      return { heading: "Due today", intro: "These records are due today.", subject: count === 1 ? "Due today" : `Due today: ${count} ${noun}` };
    case "overdue":
      return { heading: "Overdue", intro: "These records are past their due date.", subject: count === 1 ? "Overdue" : `Overdue: ${count} ${noun}` };
    case "escalated":
      return {
        heading: "Escalated to you",
        intro: "These records are overdue or have not moved, so they were escalated to the owner's manager or a quality manager.",
        subject: count === 1 ? "Escalated" : `Escalated: ${count} ${noun}`,
      };
    case "approval":
      return { heading: "Approval waiting", intro: "These document approvals or validation steps have been waiting.", subject: count === 1 ? "Approval waiting" : `Approvals waiting: ${count}` };
    case "repeat_ncr":
      return { heading: "Repeat issue — consider a CAPA", intro: "This nonconformance matches earlier NCRs. Quality should consider a CAPA that covers the group.", subject: "Repeat NCR — consider a CAPA" };
    case "digest":
      return { heading: "Your AccuQual day", intro: "Overdue and due-soon work assigned to you, plus approvals waiting on you.", subject: count === 1 ? "Your AccuQual day: 1 item" : `Your AccuQual day: ${count} items` };
    default:
      return { heading: "AccuQual", intro: "Open the record for the details.", subject: "AccuQual" };
  }
}
