import type { FormImportField } from "./formImport.templates.js";
import { normalizeLabel, type SourceColumn } from "./formImport.parse.js";

export interface MappingEntry {
  fieldKey: string;
  columnIndex: number | null;
  confidence: number;
  reason: string;
}

const STOP = new Set(["the", "of", "and", "a", "to", "at"]);

function tokens(value: string): string[] {
  return normalizeLabel(value)
    .split(" ")
    .filter((word) => word.length > 1 && !STOP.has(word));
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const next = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      next[j] = Math.min(next[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
    }
    prev = next;
  }
  return prev[b.length]!;
}

/** 1 is the same name. Below 0.62 is not offered as a suggestion. */
export function matchScore(header: string, field: FormImportField): number {
  const left = normalizeLabel(header);
  if (!left) return 0;
  const names = [field.label, field.key, ...field.aliases].map(normalizeLabel).filter(Boolean);
  if (names.includes(left)) return 1;
  let best = 0;
  const headerTokens = new Set(tokens(left));
  for (const name of names) {
    const shorter = Math.min(left.length, name.length);
    const longer = Math.max(left.length, name.length);
    if (longer >= 4 && shorter / longer >= 0.62 && (left.includes(name) || name.includes(left))) {
      best = Math.max(best, 0.8 + (0.15 * shorter) / longer);
    }
    const nameTokens = tokens(name);
    if (headerTokens.size > 0 && nameTokens.length > 0) {
      const intersection = nameTokens.filter((token) => headerTokens.has(token)).length;
      const union = new Set([...headerTokens, ...nameTokens]).size;
      const overlap = intersection / union;
      if (overlap >= 0.5) best = Math.max(best, 0.55 + overlap * 0.3);
    }
    if (left.length <= 32 && name.length <= 32) {
      const ratio = 1 - levenshtein(left, name) / longer;
      if (ratio >= 0.84) best = Math.max(best, ratio * 0.92);
    }
  }
  return Math.round(best * 100) / 100;
}

function reasonFor(score: number): string {
  if (score >= 0.99) return "Exact match";
  if (score >= 0.8) return "Alias match";
  if (score >= 0.62) return "Similar name";
  return "";
}

/** Greedy one-to-one match. A column is used for at most one field. */
export function suggestMapping(fields: FormImportField[], columns: SourceColumn[]): MappingEntry[] {
  const pairs: { fieldKey: string; columnIndex: number; score: number }[] = [];
  for (const field of fields) {
    for (const column of columns) {
      const score = matchScore(column.header, field);
      if (score >= 0.62) pairs.push({ fieldKey: field.key, columnIndex: column.index, score });
    }
  }
  pairs.sort((a, b) => b.score - a.score || a.fieldKey.localeCompare(b.fieldKey));
  const usedFields = new Set<string>();
  const usedColumns = new Set<number>();
  const chosen = new Map<string, { columnIndex: number; score: number }>();
  for (const pair of pairs) {
    if (usedFields.has(pair.fieldKey) || usedColumns.has(pair.columnIndex)) continue;
    usedFields.add(pair.fieldKey);
    usedColumns.add(pair.columnIndex);
    chosen.set(pair.fieldKey, { columnIndex: pair.columnIndex, score: pair.score });
  }
  return fields.map((field) => {
    const match = chosen.get(field.key);
    if (!match) return { fieldKey: field.key, columnIndex: null, confidence: 0, reason: "" };
    return { fieldKey: field.key, columnIndex: match.columnIndex, confidence: match.score, reason: reasonFor(match.score) };
  });
}

export function mappingFromEntries(entries: MappingEntry[]): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  for (const entry of entries) mapping[entry.fieldKey] = entry.columnIndex;
  return mapping;
}
