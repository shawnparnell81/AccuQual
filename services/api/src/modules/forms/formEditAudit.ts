import type { Request, Response } from "express";
import { asyncHandler } from "../../utils/asyncHandler.js";
import { AppError } from "../../utils/appError.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import type { Db } from "../../lib/requestDb.js";

export interface FormEdit {
  label: string;
  from: string;
  to: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

/** A spreadsheet address stays a cell name. A camelCase key becomes a field name. */
export function cellLabel(key: string): string {
  if (/^[A-Z]{1,3}\d+$/.test(key)) return `Cell ${key}`;
  const spaced = key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim();
  if (!spaced) return key;
  return spaced
    .split(/\s+/)
    .map((word) => (word.toLowerCase() === "ncr" ? "NCR" : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(" ");
}

export function showAuditValue(value: unknown): string {
  if (value == null || value === "") return "(blank)";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  if (typeof value === "string") return value.length > 180 ? `${value.slice(0, 177)}…` : value;
  if (Array.isArray(value)) return value.map((item) => showAuditValue(item)).join(", ") || "(blank)";
  return "(blank)";
}

function same(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  try {
    return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
  } catch {
    return false;
  }
}

export function scalarEdits(before: Record<string, unknown>, after: Record<string, unknown>, keys?: string[]): FormEdit[] {
  const names = keys ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const edits: FormEdit[] = [];
  for (const key of names) {
    if (key.startsWith("_")) continue;
    if (keys == null && !(key in after)) continue;
    const from = before[key];
    const to = after[key];
    if (same(from ?? "", to ?? "")) continue;
    if (from && typeof from === "object") continue;
    if (to && typeof to === "object") continue;
    edits.push({ label: cellLabel(key), from: showAuditValue(from), to: showAuditValue(to) });
  }
  return edits;
}

function diffCells(before: unknown, after: unknown): FormEdit[] {
  const left = asRecord(before) ?? {};
  const right = asRecord(after) ?? {};
  return scalarEdits(left, right);
}

/** Checkbox groups store `{ "Major": true }`. Auditors should read the chosen words, not the object. */
function checkboxText(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;
  const entries = Object.entries(record);
  if (entries.length === 0 || entries.some(([, on]) => typeof on !== "boolean")) return null;
  const selected = entries.filter(([, on]) => on).map(([name]) => name);
  return selected.length > 0 ? selected.join(", ") : "(blank)";
}

function structuredText(value: unknown): string | null {
  const checks = checkboxText(value);
  if (checks != null) return checks;
  if (value == null || value === "") return "(blank)";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return showAuditValue(value);
  return null;
}

function rowTitle(label: string, index: number, record: Record<string, unknown> | null): string {
  if (record && typeof record.characteristic === "string" && record.characteristic.trim()) return record.characteristic.trim();
  if (record && typeof record.name === "string" && record.name.trim()) return record.name.trim();
  return `${label} ${index + 1}`;
}

function pushStructured(edits: FormEdit[], label: string, from: unknown, to: unknown): void {
  const fromShown = structuredText(from);
  const toShown = structuredText(to);
  if (fromShown == null || toShown == null || fromShown === toShown) return;
  edits.push({ label, from: fromShown, to: toShown });
}

function diffList(label: string, before: unknown, after: unknown): FormEdit[] {
  const left = Array.isArray(before) ? before : [];
  const right = Array.isArray(after) ? after : [];
  const edits: FormEdit[] = [];
  const count = Math.max(left.length, right.length);
  for (let index = 0; index < count; index += 1) {
    const from = left[index];
    const to = right[index];
    if (same(from, to)) continue;
    const fromRecord = asRecord(from);
    const toRecord = asRecord(to);
    const rowLabel = rowTitle(label, index, toRecord ?? fromRecord);
    if (fromRecord || toRecord) {
      for (const key of new Set([...Object.keys(fromRecord ?? {}), ...Object.keys(toRecord ?? {})])) {
        if (key.startsWith("_") || key === "result") continue;
        const beforeValue = fromRecord?.[key];
        const afterValue = toRecord?.[key];
        if (same(beforeValue, afterValue)) continue;
        const fromShown = structuredText(beforeValue);
        const toShown = structuredText(afterValue);
        if (fromShown != null && toShown != null) {
          if (fromShown !== toShown) edits.push({ label: `${rowLabel} ${cellLabel(key)}`, from: fromShown, to: toShown });
          continue;
        }
        if ((beforeValue && typeof beforeValue === "object") || (afterValue && typeof afterValue === "object")) continue;
        edits.push({ label: `${rowLabel} ${cellLabel(key)}`, from: showAuditValue(beforeValue), to: showAuditValue(afterValue) });
      }
      continue;
    }
    pushStructured(edits, `${label} ${index + 1}`, from, to);
  }
  return edits;
}

const FORM_DIFF_SKIP = new Set(["cells", "lines", "customers", "problems", "months", "photos"]);

/** Field and cell changes between two saved form payloads. Signature bookkeeping stays on its own audit row. */
export function formDataEdits(previousData: unknown, nextData: unknown): FormEdit[] {
  const prev = asRecord(previousData) ?? {};
  const next = asRecord(nextData) ?? {};
  const edits = diffCells(prev.cells, next.cells);
  edits.push(...diffList("Line", prev.lines, next.lines));
  edits.push(...diffList("Customer", prev.customers, next.customers));
  edits.push(...diffList("Problem", prev.problems, next.problems));
  if (!same(prev.months, next.months)) {
    edits.push({ label: "Months", from: showAuditValue(prev.months), to: showAuditValue(next.months) });
  }
  if (!same(prev.photos, next.photos)) {
    edits.push({ label: "Photos", from: showAuditValue(prev.photos), to: showAuditValue(next.photos) });
  }
  for (const key of new Set([...Object.keys(prev), ...Object.keys(next)])) {
    if (key.startsWith("_") || FORM_DIFF_SKIP.has(key)) continue;
    const before = prev[key];
    const after = next[key];
    if (same(before ?? "", after ?? "")) continue;
    if (Array.isArray(before) || Array.isArray(after)) {
      edits.push(...diffList(cellLabel(key), before, after));
      continue;
    }
    const fromShown = structuredText(before);
    const toShown = structuredText(after);
    if (fromShown == null || toShown == null || fromShown === toShown) continue;
    edits.push({ label: cellLabel(key), from: fromShown, to: toShown });
  }
  return edits;
}

/** Audit body for a form save. Drops the raw data blob once the cell list is known. */
export function withFormEdits(changes: Record<string, unknown>, previousData: unknown, nextData: unknown): Record<string, unknown> {
  const edits = formDataEdits(previousData, nextData);
  if (edits.length === 0) return changes;
  const next: Record<string, unknown> = { ...changes, event: typeof changes.event === "string" ? changes.event : "form_saved", edits };
  delete next.data;
  return next;
}

/** Add field lines (old -> new) for the scalar keys in a patch. Nested form data stays on withFormEdits. */
export function withScalarEdits(existing: Record<string, unknown>, patch: Record<string, unknown>, changes: Record<string, unknown>): Record<string, unknown> {
  const edits = scalarEdits(existing, { ...existing, ...patch }, Object.keys(patch));
  if (edits.length === 0) return changes;
  const prior = Array.isArray(changes.edits) ? (changes.edits as FormEdit[]) : [];
  return { ...changes, event: typeof changes.event === "string" ? changes.event : "form_saved", edits: [...prior, ...edits] };
}

/**
 * A saved file node should open its own record.
 * A folder that still has children keeps its own link. A node shared by several filings does too.
 */
export function shouldRepairFiledLink(input: { linkedPath: string | null; expected: string; soleFiling: boolean; hasChildren: boolean }): boolean {
  if (!input.soleFiling || input.hasChildren) return false;
  return (input.linkedPath ?? "") !== input.expected;
}

/** POST /:id/begin-edit — records that someone unlocked a saved form. The route's department gate decides who may write. */
export function beginFormEditHandler(entityType: string, load: (db: Db, id: number) => Promise<unknown>) {
  return asyncHandler(async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) throw AppError.badRequest("Record is required");
    const row = await load(req.db!, id);
    if (!row) throw AppError.notFound(entityType);
    await recordAuditTrail(req.db!, {
      entityType,
      entityId: id,
      action: "update",
      changes: { event: "edit_started" },
      performedBy: req.user?.id,
    });
    res.json({ editing: true });
  });
}
