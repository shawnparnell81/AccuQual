import { formatDateTime } from "./dates";
import { baselineCell } from "./templateBaseline";

/**
 * One audit line, in the order an auditor reads it.
 * Built from the row the API already returns (action, changes, field diffs,
 * resolved actor). Nothing new is stored, so older rows still render.
 */
export interface AuditFieldChange {
  op: string;
  changes: Record<string, { from?: unknown; to?: unknown }>;
}

export interface AuditEntryLike {
  action: string;
  changes?: Record<string, unknown> | null;
  fieldChanges?: AuditFieldChange[] | null;
  performedByName?: string | null;
  performedBy?: number | null;
  performedByAvatarUrl?: string | null;
}

export interface AuditLine {
  who: string;
  what: string;
  description: string;
}

/** Shown when an older row has an action and an actor but no usable detail. */
export const AUDIT_DETAIL_FALLBACK = "No further detail was recorded.";

const NOISE = new Set([
  "id",
  "createdat",
  "updatedat",
  "createdby",
  "updatedby",
  "tokenversion",
  "passwordhash",
  "performedby",
  "snapshot",
  "validationdetails",
  "statuscode",
  "source",
  "formtemplate",
]);

const SECRET = /password|passwd|secret|token|api.?key|credential|hash|jwt/i;
const AI_KEY = /^(ai|llm|pipeline|model)/i;
const BLOB_KEY = /data|answers|payload|definition|formdata|sections|content|metadata|versionhistory/i;
const IDENTITY = new Set(["title", "name", "description", "status", "severity", "number", "recordnumber", "partnumber", "filename", "finding"]);

const KEEP_WITH_FIELDS = new Set([
  "form_saved",
  "published",
  "submitted_for_review",
  "review_approved",
  "review_rejected",
  "draft_created",
  "draft_edited",
  "draft_discarded",
  "rollback_draft_created",
  "upload_certificate",
  "upload_template",
  "office_file_saved",
  "file_saved",
  "file_downloaded",
  "quarantine_moved",
  "item_added",
  "item_updated",
  "item_removed",
  "row_added",
  "row_updated",
  "row_removed",
  "form_saved",
  "edit_started",
  "edit_reverted",
  "escalate_to_ncr",
  "fmea_item_added",
  "obsolete",
]);

function normKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mentionsAi(text: string): boolean {
  return /\bAI\b|artificial intelligence/i.test(text);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function stringField(obj: Record<string, unknown> | null, key: string): string | null {
  if (!obj) return null;
  const value = obj[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || mentionsAi(trimmed)) return null;
  return trimmed;
}

function fieldLabel(key: string): string {
  if (normKey(key) === "actionplan") return "What you'll do";
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  if (!spaced) return key;
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** NCR workflow steps, including the words stored before the six-step process. Shared words (open, closed, investigating) stay as they are so other modules are unchanged. */
const NCR_AUDIT_STATUS: Record<string, string> = {
  ncr_created: "NCR Created",
  contain: "Contain",
  contained: "Contain",
  disposition: "Disposition",
  fix: "Fix",
  verify: "Verify",
  corrective_action: "Fix",
};

function isDateKey(key: string): boolean {
  return /(At|Date)$/.test(key) || /_(at|date)$/.test(key);
}

/**
 * Postgres `timestamp` values land in audit JSON without a zone. The history
 * When column is an ISO instant (UTC). Treat a zone-less date-time the same
 * way, then format it in the user's local time.
 */
export function asUtcIso(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || /(?:z|Z|[+-]\d{2}:?\d{2})$/.test(trimmed)) return trimmed;
  const naive = trimmed.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)$/);
  const day = naive?.[1];
  const clock = naive?.[2];
  if (!day || !clock) return trimmed;
  const time = clock.length === 5 ? `${clock}:00` : clock;
  return `${day}T${time}Z`;
}

function skipKey(key: string): boolean {
  if (SECRET.test(key) || AI_KEY.test(key)) return true;
  return NOISE.has(normKey(key));
}

/** A short display value. Objects return null so the caller does not print JSON. */
function displayValue(value: unknown, key?: string): string | null {
  if (value === null || value === undefined || value === "") return "empty";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  if (key === "status") {
    const named = NCR_AUDIT_STATUS[value];
    if (named) return named.includes(" ") ? `"${named}"` : named;
  }
  if (mentionsAi(value)) return null;
  if (value === "[redacted]") return "a hidden value";
  if (value.startsWith("[large value:")) return "a long value";
  if (key && isDateKey(key)) {
    const formatted = formatDateTime(asUtcIso(value));
    if (formatted !== "—") return formatted;
  }
  const words = value.replace(/_/g, " ").trim();
  if (!words) return "empty";
  if (words.length > 80) return `"${words.slice(0, 77)}…"`;
  return /\s/.test(words) ? `"${words}"` : words;
}

function sentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function fileSentence(changes: Record<string, unknown> | null): string | null {
  const name = stringField(changes, "fileName") ?? stringField(changes, "filename");
  return name ? `File "${name}".` : null;
}

function specificCode(changes: Record<string, unknown> | null): string | null {
  const code = stringField(changes, "event") ?? stringField(changes, "subAction") ?? stringField(changes, "action");
  if (!code) return null;
  const lower = code.toLowerCase();
  if (lower === "create" || lower === "update" || lower === "delete" || lower === "status_change") return null;
  return lower;
}

function hasFile(changes: Record<string, unknown> | null): boolean {
  return !!(stringField(changes, "fileName") ?? stringField(changes, "filename"));
}

function isAttachment(action: string, changes: Record<string, unknown> | null, code: string | null): boolean {
  if (code && /(upload|attach|added_?document|office_file_saved|file_saved)/.test(code)) return true;
  if (action === "delete" || !hasFile(changes)) return false;
  const extra = Object.keys(changes ?? {}).filter(
    (key) => !["fileName", "filename", "attachedTo", "fileId", "sizeBytes", "sha256", "mimeType", "action", "event", "subAction"].includes(key),
  );
  return extra.length === 0;
}

function auditWhat(action: string, changes?: Record<string, unknown> | null): string {
  const record = asRecord(changes);
  if (action === "delete") return "Deleted";
  if (action === "transition_failed") return "Change failed";
  if (action === "permission_denied") return "Change blocked";
  if (action === "decision") return "Decision recorded";
  const code = specificCode(record);
  if (code === "moved") return "Moved";
  if (code === "renamed") return "Renamed";
  if (code === "login") return "Signed in";
  if (code === "logout") return "Signed out";
  if (code && /publish/.test(code)) return "Published";
  if (code && /file_downloaded|download/.test(code)) return "Downloaded file";
  if (code === "imported") return "Imported";
  if (code === "form_saved") return "Saved";
  if (code === "edit_started") return "Opened for editing";
  if (code === "edit_reverted") return "Reverted the edit";
  if (isAttachment(action, record, code)) return "Attached file";
  if (action === "create") return "Created";
  if (action === "status_change") return "Status changed";
  if (action === "update") return "Updated";
  const plain = action.replace(/_/g, " ").trim();
  return plain ? fieldLabel(plain) : "Recorded";
}

function eventDetail(changes: Record<string, unknown> | null, code: string | null): string | null {
  if (!code) return null;
  const version = typeof changes?.version === "number" ? ` version ${changes.version}` : "";
  switch (code) {
    case "published": {
      const replaced = typeof changes?.replaced === "number" ? changes.replaced : null;
      return replaced != null ? `Published${version}, replacing version ${replaced}.` : `Published${version}.`;
    }
    case "submitted_for_review":
      return `Submitted${version} for review.`;
    case "review_approved":
      return `Approved${version}.`;
    case "review_rejected":
      return `Rejected${version}.`;
    case "draft_created":
      return `Started draft${version}.`;
    case "draft_edited":
      return `Edited draft${version}.`;
    case "draft_discarded":
      return `Discarded draft${version}.`;
    case "rollback_draft_created":
      return typeof changes?.rollbackTo === "number" ? `Started a draft that rolls back to version ${changes.rollbackTo}.` : `Started a rollback draft${version}.`;
    case "upload_certificate":
    case "upload_template":
      return fileSentence(changes) ?? "Attached a file.";
    case "office_file_saved":
    case "file_saved":
      return fileSentence(changes) ?? "Saved the file.";
    case "file_downloaded":
      return fileSentence(changes) ?? "Downloaded the file.";
    case "quarantine_moved": {
      const from = displayValue(changes?.from);
      const to = displayValue(changes?.to);
      if (from && to) return `Moved from ${from} to ${to}.`;
      return "Moved the held item.";
    }
    case "investigation_opened":
      return "Opened a Discrepancy Investigation from this item.";
    case "ncr_opened":
      return "Opened an NCR from this item.";
    case "item_added":
    case "row_added":
      return "Added a line.";
    case "item_updated":
    case "row_updated":
      return "Updated a line.";
    case "item_removed":
    case "row_removed":
      return "Removed a line.";
    case "escalate_to_ncr":
      return "Escalated this record to an NCR.";
    case "fmea_item_added": {
      const mode = stringField(changes, "failureMode");
      return mode ? `Added failure mode "${mode}".` : "Added a failure mode.";
    }
    case "login": {
      const method = stringField(changes, "method");
      if (method === "mfa") return "Signed in with a password and an authenticator code.";
      if (method === "trusted_device") return "Signed in with a password on a trusted browser.";
      return "Signed in with a password.";
    }
    case "logout":
      return "Signed out.";
    case "password_reset":
      return "Reset the password.";
    case "password_changed":
      return "Changed the password.";
    case "account_locked":
      return "Locked the account after too many failed sign-ins.";
    case "account_unlocked":
      return "Cleared the sign-in lockout.";
    case "mfa_enabled":
      return "Turned on two-step sign-in.";
    case "mfa_disabled":
      return "Turned off two-step sign-in.";
    case "mfa_reset_by_admin":
      return "Reset two-step sign-in.";
    case "mfa_recovery_code_used":
      return "Signed in with a recovery code.";
    case "mfa_recovery_codes_regenerated":
      return "Regenerated recovery codes.";
    case "deactivate":
      return "Turned the account off.";
    case "hard_delete":
      return "Erased the account.";
    case "temporary_password_set":
      return "Set a temporary password.";
    case "closed":
    case "close":
      return "Closed this record.";
    case "containment":
      return "Recorded containment. Step is now Contain.";
    case "disposition":
      return "Recorded disposition. Step is now Disposition.";
    case "root_cause":
      return "Recorded the root cause.";
    case "fix":
    case "corrective_action":
      return "Recorded the fix. Step is now Fix.";
    case "verify":
      return "Recorded verification. Step is now Verify.";
    case "assigned":
      return "Updated the assignee.";
    case "obsolete":
      return "Marked this record obsolete.";
    case "form_saved":
      return "Saved the form.";
    case "edit_started":
      return "Opened the form for editing.";
    case "edit_reverted":
      return "Reverted the edit.";
    default:
      return `${fieldLabel(code)}.`;
  }
}

function numericId(value: unknown): boolean {
  return typeof value === "number" || (typeof value === "string" && /^[1-9]\d*$/.test(value));
}

/** One level of a form object: name the fields that changed, and never print the object itself. */
function diffRecord(valueFrom: unknown, valueTo: unknown): string[] {
  const left = asRecord(valueFrom);
  const right = asRecord(valueTo);
  if (!left && !right) return [];
  if (Object.keys(left ?? {}).length + Object.keys(right ?? {}).length > 40) return [];
  const bits: string[] = [];
  for (const child of [...new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])]) {
    if (/^\d+$/.test(child) || skipKey(child)) continue;
    const before = left?.[child];
    const after = right?.[child];
    if (Object.is(before, after)) continue;
    if (before && after && typeof before === "object" && typeof after === "object") {
      try {
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
      } catch {
        // Unserializable values are still reported as changed, without printing them.
      }
    }
    const name = fieldLabel(child);
    const beforeShown = displayValue(before, child);
    const afterShown = displayValue(after, child);
    const hadBefore = !!left && Object.prototype.hasOwnProperty.call(left, child);
    const hasAfter = !!right && Object.prototype.hasOwnProperty.call(right, child);
    if (beforeShown && afterShown) {
      if (beforeShown === afterShown) continue;
      if (beforeShown === "a hidden value" || afterShown === "a hidden value") bits.push(`${name} changed (value hidden).`);
      else if (hadBefore && hasAfter) bits.push(`${name} changed from ${beforeShown} to ${afterShown}.`);
      else if (hasAfter) bits.push(`${name} set to ${afterShown}.`);
      else bits.push(`${name} was ${beforeShown}.`);
    } else if (child !== "cells" && child !== "data") {
      bits.push(`${name} changed.`);
    }
    if (bits.length === 4) break;
  }
  return bits;
}

function isoBlank(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (Array.isArray(value)) return value.every(isoBlank);
  return false;
}

function isoShown(value: unknown): string {
  if (Array.isArray(value)) {
    const parts = value.map((item) => isoShown(item)).filter((item) => item !== "(blank)");
    return parts.length > 0 ? parts.join(", ") : "(blank)";
  }
  if (isoBlank(value)) return "(blank)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value === "string") return value.trim();
  return "(blank)";
}

function isoSame(left: unknown, right: unknown): boolean {
  if (isoBlank(left) && isoBlank(right)) return true;
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
}

function describeIsoRows(label: string, before: unknown, after: unknown, monthNames?: unknown[]): string[] {
  const left = Array.isArray(before) ? before : [];
  const right = Array.isArray(after) ? after : [];
  const lines: string[] = [];
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const from = asRecord(left[index]) ?? {};
    const to = asRecord(right[index]) ?? {};
    if (!asRecord(left[index]) && !asRecord(right[index])) continue;
    const title = label === "Problem" ? `${label} ${index + 1}` : typeof (to.name ?? to.characteristic ?? from.name ?? from.characteristic) === "string" && String(to.name ?? to.characteristic ?? from.name ?? from.characteristic).trim() ? String(to.name ?? to.characteristic ?? from.name ?? from.characteristic).trim() : `${label} ${index + 1}`;
    for (const key of new Set([...Object.keys(from), ...Object.keys(to)])) {
      if (key.startsWith("_") || key === "result" || key === "band" || skipKey(key)) continue;
      const previous = from[key];
      const next = to[key];
      if (isoSame(previous, next)) continue;
      if (Array.isArray(previous) || Array.isArray(next)) {
        const prevList = Array.isArray(previous) ? previous : [];
        const nextList = Array.isArray(next) ? next : [];
        const slots = Math.max(prevList.length, nextList.length);
        for (let slot = 0; slot < slots; slot += 1) {
          if (isoSame(prevList[slot], nextList[slot])) continue;
          if ((prevList[slot] && typeof prevList[slot] === "object") || (nextList[slot] && typeof nextList[slot] === "object")) continue;
          const heading = key === "months" && typeof monthNames?.[slot] === "string" && String(monthNames[slot]).trim() ? String(monthNames[slot]).trim() : key === "months" ? `Month ${slot + 1}` : `${fieldLabel(key)} ${slot + 1}`;
          lines.push(`${title} ${heading} changed from ${isoShown(prevList[slot])} to ${isoShown(nextList[slot])}.`);
        }
        continue;
      }
      if ((previous && typeof previous === "object") || (next && typeof next === "object")) continue;
      const field = label === "Problem" && key === "problem" ? title : `${title} ${fieldLabel(key)}`;
      lines.push(`${field} changed from ${isoShown(previous)} to ${isoShown(next)}.`);
    }
  }
  return lines;
}

function describeIsoData(before: unknown, after: unknown): string[] {
  const left = asRecord(before) ?? {};
  const right = asRecord(after) ?? {};
  const lines: string[] = [];
  const leftCells = asRecord(left.cells) ?? {};
  const rightCells = asRecord(right.cells) ?? {};
  const formType = typeof right.formType === "string" ? right.formType : typeof left.formType === "string" ? left.formType : undefined;
  for (const key of new Set([...Object.keys(leftCells), ...Object.keys(rightCells)])) {
    if (isoSame(leftCells[key], rightCells[key])) continue;
    if (baselineCell(formType, key, leftCells[key], rightCells[key])) continue;
    if ((leftCells[key] && typeof leftCells[key] === "object") || (rightCells[key] && typeof rightCells[key] === "object")) continue;
    lines.push(`Cell ${key} changed from ${isoShown(leftCells[key])} to ${isoShown(rightCells[key])}.`);
  }
  const monthNames = Array.isArray(right.months) ? right.months : Array.isArray(left.months) ? left.months : undefined;
  lines.push(...describeIsoRows("Customer", left.customers, right.customers));
  lines.push(...describeIsoRows("Problem", left.problems, right.problems, monthNames));
  lines.push(...describeIsoRows("Line", left.lines, right.lines));
  if (!isoSame(left.months, right.months)) lines.push(`Months changed from ${isoShown(left.months)} to ${isoShown(right.months)}.`);
  return lines;
}

function fieldSentence(key: string, pair: { from?: unknown; to?: unknown }): string | null {
  if (skipKey(key)) return null;
  if (normKey(key) === "data") {
    const lines = describeIsoData(pair.from, pair.to);
    return lines.length > 0 ? lines.join(" ") : null;
  }
  if (normKey(key).endsWith("id") && numericId(pair.from) && (pair.to === undefined || numericId(pair.to))) return null;
  if (normKey(key).endsWith("id") && pair.from === undefined && numericId(pair.to)) return null;
  const label = fieldLabel(key);
  const fromShown = "from" in pair ? displayValue(pair.from, key) : undefined;
  const toShown = "to" in pair ? displayValue(pair.to, key) : undefined;
  if (fromShown === null || toShown === null) {
    const detailed = diffRecord(pair.from, pair.to);
    if (detailed.length > 0) return detailed.join(" ");
    return BLOB_KEY.test(key) ? "Form data changed." : `${label} changed.`;
  }
  if (fromShown !== undefined && toShown !== undefined) {
    if (fromShown === "a hidden value" || toShown === "a hidden value") return `${label} changed (value hidden).`;
    if (fromShown === toShown) return null;
    return `${label} changed from ${fromShown} to ${toShown}.`;
  }
  if (toShown !== undefined) return `${label} set to ${toShown}.`;
  if (fromShown !== undefined) return `${label} was ${fromShown}.`;
  return null;
}

function fieldSentences(fieldChanges: AuditFieldChange[], omit: string[] = []): string[] {
  const lines: string[] = [];
  const skipped = new Set(omit);
  let formData = false;
  for (const group of fieldChanges) {
    const entries = Object.entries(group.changes);
    const usable = group.op === "INSERT" || group.op === "DELETE" ? entries.filter(([key]) => IDENTITY.has(normKey(key))) : entries;
    for (const [key, pair] of usable) {
      if (skipped.has(normKey(key))) continue;
      const line = fieldSentence(key, pair);
      if (!line) continue;
      if (line === "Form data changed.") {
        formData = true;
        continue;
      }
      lines.push(line);
    }
  }
  if (formData) lines.push("Form data changed.");
  return lines;
}

function capFields(lines: string[]): string[] {
  if (lines.length <= 4) return lines;
  const extra = lines.length - 4;
  return [...lines.slice(0, 4), `${extra} more ${extra === 1 ? "field" : "fields"} changed.`];
}

function pushScalar(out: string[], key: string, value: unknown): void {
  if (skipKey(key)) return;
  if (normKey(key).endsWith("id") && numericId(value)) return;
  const shown = displayValue(value, key);
  if (shown === null) {
    const detailed = diffRecord(undefined, value);
    if (detailed.length > 0) out.push(...detailed);
    else if (BLOB_KEY.test(key)) out.push("Form data changed.");
    return;
  }
  if (shown === "empty") return;
  out.push(`${fieldLabel(key)} set to ${shown}.`);
}

function valueSentences(changes: Record<string, unknown> | null, code: string | null): string[] {
  if (!changes) return [];
  const out: string[] = [];
  const from = changes.from ?? changes.oldStatus;
  const to = changes.to ?? changes.newStatus;
  if (code !== "quarantine_moved" && from != null && to != null && code !== "published") {
    const fromShown = displayValue(from);
    const toShown = displayValue(to);
    if (fromShown && toShown) out.push(`Status changed from ${fromShown} to ${toShown}.`);
  }
  const status = stringField(changes, "status");
  if (status && from == null && to == null) out.push(`Status set to ${displayValue(status)}.`);

  if (!fileSentence(changes) || !(code && /(upload|attach|file_saved|file_downloaded)/.test(code))) {
    const file = fileSentence(changes);
    if (file && !out.includes(file)) out.push(file);
  }

  const patch = asRecord(changes.patch);
  if (patch) {
    for (const [key, value] of Object.entries(patch)) pushScalar(out, key, value);
  }

  const changed = changes.fieldsChanged;
  if (Array.isArray(changed) && changed.every((item) => typeof item === "string")) {
    const names = changed.map((item) => fieldLabel(item)).filter(Boolean).slice(0, 6);
    if (names.length === 1) out.push(`Changed ${names[0]!.toLowerCase()}.`);
    else if (names.length === 2) out.push(`Changed ${names[0]!.toLowerCase()} and ${names[1]!.toLowerCase()}.`);
    else if (names.length > 2) out.push(`Changed ${names.slice(0, -1).map((name) => name.toLowerCase()).join(", ")}, and ${names[names.length - 1]!.toLowerCase()}.`);
  }

  const seen = new Set(["action", "event", "subAction", "patch", "from", "to", "oldStatus", "newStatus", "status", "fileName", "filename", "fieldsChanged", "summary", "message", "note", "notes", "reason", "reviewNotes", "errorMessage", "failureMode", "version", "replaced", "rollbackTo", "changes", "attemptedTransition", "userRole", "userDepartment", "permission", "decision", "method", "path", "edits", "rowId", "verification"]);
  for (const [key, value] of Object.entries(changes)) {
    if (seen.has(key) || skipKey(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || (value !== null && typeof value === "object")) pushScalar(out, key, value);
  }
  return out;
}

function noteSentences(changes: Record<string, unknown> | null): string[] {
  if (!changes) return [];
  const out: string[] = [];
  for (const key of ["errorMessage", "reason", "reviewNotes", "note", "notes", "message", "verification"]) {
    const text = stringField(changes, key);
    if (!text || text.startsWith("{") || text.startsWith("[")) continue;
    out.push(sentence(text.length > 240 ? `${text.slice(0, 237)}…` : text));
  }
  return out;
}

function blockedSentences(action: string, changes: Record<string, unknown> | null): string[] {
  if (!changes || (action !== "permission_denied" && action !== "transition_failed")) return [];
  const out: string[] = [];
  const tried = stringField(changes, "attemptedTransition");
  if (tried) out.push(`Tried ${tried}.`);
  const why = stringField(changes, "errorMessage") ?? stringField(changes, "reason") ?? stringField(changes, "message");
  if (why) out.push(sentence(why));
  const role = stringField(changes, "userRole");
  const department = stringField(changes, "userDepartment");
  const bits: string[] = [];
  if (role) bits.push(`role ${fieldLabel(role).toLowerCase()}`);
  if (department) bits.push(`department ${fieldLabel(department).toLowerCase()}`);
  if (bits.length > 0) out.push(`Signed in as ${bits.join(", ")}.`);
  return out;
}

function decisionSentence(action: string, changes: Record<string, unknown> | null): string | null {
  if (action !== "decision") return null;
  const decision = stringField(changes, "decision");
  if (decision === "accepted") return "Accepted the suggestion.";
  if (decision === "rejected") return "Rejected the suggestion.";
  return null;
}

function dedupe(lines: string[]): string[] {
  const kept: string[] = [];
  for (const line of lines) {
    const bare = line.replace(/\.$/, "").toLowerCase();
    if (!bare) continue;
    if (kept.some((item) => item.replace(/\.$/, "").toLowerCase() === bare)) continue;
    kept.push(line);
  }
  return kept;
}

function editSentences(changes: Record<string, unknown> | null): string[] {
  const edits = changes?.edits;
  if (!Array.isArray(edits)) return [];
  const lines: string[] = [];
  for (const item of edits) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = typeof row.label === "string" ? row.label.trim() : "";
    if (!label) continue;
    const from = typeof row.from === "string" && row.from.trim() ? row.from.trim() : "(blank)";
    const to = typeof row.to === "string" && row.to.trim() ? row.to.trim() : "(blank)";
    lines.push(`${label} changed from ${from} to ${to}.`);
  }
  return lines;
}

function numberEditSentence(changes: Record<string, unknown> | null): string | null {
  const edit = changes && typeof changes.numberEdit === "object" && changes.numberEdit ? (changes.numberEdit as Record<string, unknown>) : null;
  if (!edit) return null;
  const label = typeof edit.label === "string" && edit.label.trim() ? edit.label.trim() : "Record No.";
  const from = typeof edit.from === "string" && edit.from.trim() ? edit.from.trim() : "(blank)";
  const to = typeof edit.to === "string" && edit.to.trim() ? edit.to.trim() : "(blank)";
  return `${label} changed from ${from} to ${to}.`;
}

function auditDescription(action: string, changes: Record<string, unknown> | null | undefined, fieldChanges?: AuditFieldChange[] | null): string {
  const record = asRecord(changes);
  const summary = stringField(record, "summary");
  const numberLine = numberEditSentence(record);
  if (summary && !summary.startsWith("{") && !summary.startsWith("[")) {
    return numberLine && !summary.includes(numberLine) ? `${numberLine} ${summary}` : summary;
  }

  const editLines = editSentences(record);
  const fields = fieldSentences(fieldChanges ?? [], editLines.length > 0 ? ["data"] : []);
  const code = specificCode(record);
  const lead = eventDetail(record, code);
  const parts: string[] = [];
  if (lead && (fields.length === 0 || (code && KEEP_WITH_FIELDS.has(code)))) parts.push(lead);
  parts.push(...(fields.length > 0 ? capFields(fields) : valueSentences(record, code)));
  parts.push(...editLines);
  const decision = decisionSentence(action, record);
  if (decision) parts.push(decision);
  parts.push(...blockedSentences(action, record));
  if (action !== "permission_denied" && action !== "transition_failed") {
    for (const note of noteSentences(record)) parts.push(note);
  }
  if (numberLine) parts.unshift(numberLine);
  const unique = dedupe(parts);
  const text = unique.length > 0 ? unique.join(" ") : AUDIT_DETAIL_FALLBACK;
  return text.replace(/\.\.(?!\.)/g, ".").replace(/\s+\./g, ".");
}

export function formatAuditLine(entry: AuditEntryLike): AuditLine {
  const changes = asRecord(entry.changes);
  return {
    who: entry.performedByName?.trim() || "System",
    what: auditWhat(entry.action, changes),
    description: auditDescription(entry.action, changes, entry.fieldChanges),
  };
}
