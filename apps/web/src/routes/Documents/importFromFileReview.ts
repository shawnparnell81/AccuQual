export type ReviewValue = string | string[][] | null;

export interface TargetField {
  key: string;
  label: string;
  group: string;
  type: string;
  columns?: { id: string; label: string }[];
}

export type RowStatus = "Matched" | "Edited" | "Empty";

export interface ReviewRow {
  field: TargetField;
  original: ReviewValue;
  value: ReviewValue;
  source: string | null;
}

export function sameValue(a: ReviewValue, b: ReviewValue): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function isEmptyValue(value: ReviewValue): boolean {
  if (value == null) return true;
  if (Array.isArray(value)) return value.length === 0;
  return value.trim() === "";
}

export function rowStatus(row: Pick<ReviewRow, "value" | "original">): RowStatus {
  if (isEmptyValue(row.value)) return "Empty";
  if (sameValue(row.value, row.original)) return "Matched";
  return "Edited";
}

export function countEdited(rows: Pick<ReviewRow, "value" | "original">[]): number {
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
