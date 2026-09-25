import type { DiffEntry, DiffResult } from "../versioning/diff.js";
import { jsonEqual } from "../versioning/diff.js";
import type { Issue } from "../versioning/versioning.service.js";

/**
 * What a controlled document revision IS, as stored (frozen) in controlled_versions.payload.
 * Pure data + pure functions here; everything that touches the database lives in documentVersioning.ts.
 */
export const LINK_TYPES = ["workflow", "equipment", "supplier", "ncr", "capa", "audit", "training"] as const;
export type LinkType = (typeof LINK_TYPES)[number];

export const LINK_TYPE_LABEL: Record<LinkType, string> = {
  workflow: "Workflow",
  equipment: "Equipment",
  supplier: "Supplier",
  ncr: "NCR",
  capa: "CAPA",
  audit: "Audit",
  training: "Training",
};

export interface DocumentLink {
  type: LinkType;
  id: number;
  /** Name of the target when it was linked — kept so history still reads correctly if the target is later renamed or removed. */
  label: string;
}

/** A reference to a stored file (document_files row). Name, size and checksum ride along so a published revision proves what it held. */
export interface DocumentAttachmentRef {
  id: number;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface DocumentPayload {
  title: string;
  category: string | null;
  /** The document body (plain text / markdown). May be empty when the document is carried by attached files. */
  content: string;
  /** "Rev A", "Rev B", ... — the human-facing revision label; the engine's version number is the integer counter. */
  revisionCode: string;
  effectiveDate: string | null;
  expirationDate: string | null;
  retentionPeriodDays: number | null;
  attachments: DocumentAttachmentRef[];
  links: DocumentLink[];
}

export const MAX_CONTENT_CHARS = 200_000;
export const MAX_ATTACHMENTS = 25;
export const MAX_LINKS = 100;

export const blankDocumentPayload = (): DocumentPayload => ({
  title: "",
  category: null,
  content: "",
  revisionCode: "Rev A",
  effectiveDate: null,
  expirationDate: null,
  retentionPeriodDays: null,
  attachments: [],
  links: [],
});

/** Fills anything missing so code never has to guard against a partial payload (older versions, hand-built API calls). */
export function normalizeDocumentPayload(input: Record<string, unknown> | undefined | null): DocumentPayload {
  const p = (input ?? {}) as Partial<DocumentPayload>;
  const base = blankDocumentPayload();
  return {
    title: typeof p.title === "string" ? p.title : base.title,
    category: typeof p.category === "string" && p.category.trim() ? p.category : null,
    content: typeof p.content === "string" ? p.content : base.content,
    revisionCode: typeof p.revisionCode === "string" && p.revisionCode.trim() ? p.revisionCode.trim() : base.revisionCode,
    effectiveDate: typeof p.effectiveDate === "string" && p.effectiveDate ? p.effectiveDate : null,
    expirationDate: typeof p.expirationDate === "string" && p.expirationDate ? p.expirationDate : null,
    retentionPeriodDays: typeof p.retentionPeriodDays === "number" ? p.retentionPeriodDays : null,
    attachments: Array.isArray(p.attachments) ? (p.attachments as DocumentAttachmentRef[]) : [],
    links: Array.isArray(p.links) ? (p.links as DocumentLink[]) : [],
  };
}

// ---- Revision codes ---------------------------------------------------------------------------------------------------------------------------------

/** 1 -> "A", 26 -> "Z", 27 -> "AA" (bijective base 26, the way drawing and document revisions are lettered). */
export function lettersFor(n: number): string {
  let out = "";
  let x = Math.max(1, Math.floor(n));
  while (x > 0) {
    const r = (x - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    x = Math.floor((x - 1) / 26);
  }
  return out;
}

export const revisionCodeForNumber = (n: number) => `Rev ${lettersFor(n)}`;

/** "Rev A" -> "Rev B", "Rev Z" -> "Rev AA". A label that is not in the lettered scheme (e.g. "Rev 3") gets the next lettered code after A. */
export function nextRevisionCode(code: string | null | undefined): string {
  const m = /^Rev\s+([A-Z]+)$/i.exec((code ?? "").trim());
  if (!m) return "Rev A";
  const letters = m[1]!.toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return revisionCodeForNumber(n + 1);
}

/** The lettered value of a code, for choosing the highest of several. Codes outside the scheme rank 0. */
export function revisionRank(code: string | null | undefined): number {
  const m = /^Rev\s+([A-Z]+)$/i.exec((code ?? "").trim());
  if (!m) return 0;
  let n = 0;
  for (const ch of m[1]!.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// ---- Validation (no database) -----------------------------------------------------------------------------------------------------------------------

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}/.test(s) && !Number.isNaN(Date.parse(s));

export function validateDocumentPayload(input: Record<string, unknown>): { errors: Issue[]; warnings: Issue[] } {
  const p = normalizeDocumentPayload(input);
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (!p.title.trim()) errors.push({ code: "no_title", message: "Give the document a title." });
  if (p.title.length > 300) errors.push({ code: "title_long", message: "The title is too long (300 characters at most)." });
  if (!p.revisionCode.trim() || p.revisionCode.length > 20) errors.push({ code: "bad_revision", message: "The revision code (for example Rev A) must be 1 to 20 characters." });
  if (p.content.length > MAX_CONTENT_CHARS) errors.push({ code: "content_long", message: `The content is too long (${MAX_CONTENT_CHARS.toLocaleString()} characters at most). Attach a file instead.` });
  if (!p.content.trim() && p.attachments.length === 0) errors.push({ code: "empty", message: "The document is empty — write its content or attach a file." });
  if (p.effectiveDate && !isDate(p.effectiveDate)) errors.push({ code: "bad_effective", message: "The effective date isn't a valid date." });
  if (p.expirationDate && !isDate(p.expirationDate)) errors.push({ code: "bad_expiration", message: "The expiration date isn't a valid date." });
  if (p.effectiveDate && p.expirationDate && isDate(p.effectiveDate) && isDate(p.expirationDate) && Date.parse(p.expirationDate) <= Date.parse(p.effectiveDate)) {
    errors.push({ code: "expires_before_effective", message: "The expiration date has to be after the effective date." });
  }
  if (p.retentionPeriodDays !== null && (!Number.isInteger(p.retentionPeriodDays) || p.retentionPeriodDays < 1 || p.retentionPeriodDays > 36_500)) {
    errors.push({ code: "bad_retention", message: "The retention period must be a whole number of days (at least 1)." });
  }
  if (p.attachments.length > MAX_ATTACHMENTS) errors.push({ code: "too_many_files", message: `A revision can carry at most ${MAX_ATTACHMENTS} files.` });
  if (p.links.length > MAX_LINKS) errors.push({ code: "too_many_links", message: `A revision can link to at most ${MAX_LINKS} records.` });
  const seen = new Set<string>();
  for (const l of p.links) {
    const key = `${l.type}:${l.id}`;
    if (!LINK_TYPES.includes(l.type) || !Number.isInteger(l.id) || l.id < 1) errors.push({ code: "bad_link", message: "One of the links is not a valid record." });
    else if (seen.has(key)) errors.push({ code: "duplicate_link", message: `${LINK_TYPE_LABEL[l.type]} #${l.id} is linked twice.` });
    seen.add(key);
  }
  if (!p.effectiveDate) warnings.push({ code: "no_effective", message: "No effective date is set — the publish date will be used." });
  if (p.expirationDate && isDate(p.expirationDate) && Date.parse(p.expirationDate) < Date.now()) warnings.push({ code: "already_expired", message: "The expiration date is already in the past." });
  return { errors, warnings };
}

// ---- Diff -------------------------------------------------------------------------------------------------------------------------------------------

export interface LineDiff {
  op: "add" | "del" | "same";
  text: string;
}

const MAX_DIFF_CELLS = 4_000_000;

/** Line-by-line diff (longest common subsequence). Falls back to "everything replaced" for pathologically large inputs. */
export function diffLines(before: string, after: string): LineDiff[] {
  const a = before === "" ? [] : before.split("\n");
  const b = after === "" ? [] : after.split("\n");
  if (a.length * b.length > MAX_DIFF_CELLS) return [...a.map((text) => ({ op: "del" as const, text })), ...b.map((text) => ({ op: "add" as const, text }))];
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = a[i] === b[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: LineDiff[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: "same", text: a[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ op: "del", text: a[i++]! });
    else out.push({ op: "add", text: b[j++]! });
  }
  while (i < n) out.push({ op: "del", text: a[i++]! });
  while (j < m) out.push({ op: "add", text: b[j++]! });
  return out;
}

const summarize = (entries: DiffEntry[]): DiffResult => ({
  entries,
  summary: {
    added: entries.filter((e) => e.change === "added").length,
    removed: entries.filter((e) => e.change === "removed").length,
    changed: entries.filter((e) => e.change === "changed").length,
  },
});

const blank = (v: unknown) => v === undefined || v === null || v === "";

const META_FIELDS: { key: keyof DocumentPayload; label: string }[] = [
  { key: "title", label: "Title" },
  { key: "category", label: "Category" },
  { key: "revisionCode", label: "Revision code" },
  { key: "effectiveDate", label: "Effective date" },
  { key: "expirationDate", label: "Expiration date" },
  { key: "retentionPeriodDays", label: "Retention period (days)" },
];

/** Content, metadata, attachment and link differences between two revisions, each marked added / removed / changed. */
export function diffDocumentVersions(beforeRaw: Record<string, unknown>, afterRaw: Record<string, unknown>): DiffResult {
  const before = normalizeDocumentPayload(beforeRaw);
  const after = normalizeDocumentPayload(afterRaw);
  const entries: DiffEntry[] = [];

  for (const { key, label } of META_FIELDS) {
    const from = before[key];
    const to = after[key];
    if (jsonEqual(from, to) || (blank(from) && blank(to))) continue;
    entries.push({ change: blank(from) ? "added" : blank(to) ? "removed" : "changed", scope: "metadata", key, label, from: blank(from) ? undefined : from, to: blank(to) ? undefined : to });
  }

  if (before.content !== after.content) {
    entries.push({ change: before.content.trim() === "" ? "added" : after.content.trim() === "" ? "removed" : "changed", scope: "content", key: "content", label: "Content", lines: diffLines(before.content, after.content) });
  }

  // Files: matched by id first (same stored file), then a removed + added pair with the same name is one file that was replaced.
  const beforeIds = new Map(before.attachments.map((f) => [f.id, f]));
  const afterIds = new Map(after.attachments.map((f) => [f.id, f]));
  const removed = before.attachments.filter((f) => !afterIds.has(f.id));
  const added = after.attachments.filter((f) => !beforeIds.has(f.id));
  const replacedNames = new Set<string>();
  for (const r of removed) {
    const match = added.find((a) => a.fileName === r.fileName && !replacedNames.has(a.fileName));
    if (match) {
      replacedNames.add(r.fileName);
      entries.push({ change: "changed", scope: "attachment", key: `file:${match.id}`, label: r.fileName, from: { sizeBytes: r.sizeBytes, sha256: r.sha256 }, to: { sizeBytes: match.sizeBytes, sha256: match.sha256 } });
    }
  }
  for (const r of removed) if (!replacedNames.has(r.fileName)) entries.push({ change: "removed", scope: "attachment", key: `file:${r.id}`, label: r.fileName, from: { sizeBytes: r.sizeBytes, sha256: r.sha256 } });
  for (const a of added) if (!replacedNames.has(a.fileName)) entries.push({ change: "added", scope: "attachment", key: `file:${a.id}`, label: a.fileName, to: { sizeBytes: a.sizeBytes, sha256: a.sha256 } });

  const beforeLinks = new Map(before.links.map((l) => [`${l.type}:${l.id}`, l]));
  const afterLinks = new Map(after.links.map((l) => [`${l.type}:${l.id}`, l]));
  for (const [key, l] of beforeLinks) if (!afterLinks.has(key)) entries.push({ change: "removed", scope: "link", key, label: `${LINK_TYPE_LABEL[l.type]}: ${l.label}`, from: l.label });
  for (const [key, l] of afterLinks) if (!beforeLinks.has(key)) entries.push({ change: "added", scope: "link", key, label: `${LINK_TYPE_LABEL[l.type]}: ${l.label}`, to: l.label });

  return summarize(entries);
}
