export type ReviewValue = string | string[][] | null;

export interface TargetField {
  key: string;
  label: string;
  group: string;
  type: string;
  columns?: { id: string; label: string }[];
}

export type RowStatus = "Matched" | "Edited" | "Empty" | "Suggested";

export interface ReviewRow {
  field: TargetField;
  original: ReviewValue;
  value: ReviewValue;
  source: string | null;
  /** The server's match rule for the proposed value, e.g. "Label match" or "saved mapping". */
  reason: string;
  /** Which Phase 1 rule produced the value — what a saved mapping actually records. */
  rule: "label" | "heading" | "tableRow" | "tableField" | "named" | null;
  /** Phase 3: an AI-suggested value for a field the deterministic rules and any saved mapping left empty. Never set for a field that already has a value. Accept is off by default — ticking it (or editing the value) copies this into `value`. */
  aiSuggestion: ReviewValue | null;
}

export interface MappingEntry {
  rule: "label" | "heading" | "tableRow" | "tableField" | "named";
  source: string;
}

/** What "Save mapping for next time" stores: rule + source text for every accepted, rule-matched field. No values. */
export function buildMappingEntries(rows: Pick<ReviewRow, "field" | "value" | "source" | "rule">[]): Record<string, MappingEntry> {
  const entries: Record<string, MappingEntry> = {};
  for (const row of rows) {
    if (isEmptyValue(row.value) || !row.rule || !row.source) continue;
    entries[row.field.key] = { rule: row.rule, source: row.source };
  }
  return entries;
}

export function sameValue(a: ReviewValue, b: ReviewValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isEmptyValue(value: ReviewValue): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

export function rowStatus(row: Pick<ReviewRow, "value" | "original" | "aiSuggestion">): RowStatus {
  if (isEmptyValue(row.value)) return row.aiSuggestion != null ? "Suggested" : "Empty";
  if (sameValue(row.value, row.original)) return "Matched";
  return "Edited";
}

/** A suggestion is "accepted" the moment its field has any value — whether the reviewer ticked Accept as-is or typed over it (both count, per the spec: "edit counts as accepted-and-edited"). */
export function buildAiAccepted(rows: Pick<ReviewRow, "field" | "value" | "aiSuggestion">[]): string[] {
  return rows.filter((row) => row.aiSuggestion != null && !isEmptyValue(row.value)).map((row) => row.field.key);
}

export function countEdited(rows: Pick<ReviewRow, "value" | "original" | "aiSuggestion">[]): number {
  return rows.filter((row) => rowStatus(row) === "Edited").length;
}

/** Only non-empty fields are sent — an Empty row is left out, not saved as "". */
export function buildConfirmValues(rows: Pick<ReviewRow, "field" | "value">[]): Record<string, ReviewValue> {
  const values: Record<string, ReviewValue> = {};
  for (const row of rows) {
    if (!isEmptyValue(row.value)) values[row.field.key] = row.value;
  }
  return values;
}
