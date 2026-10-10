/** Column maps are stored by header name, so next month's file can move columns and still match. */

export function normalizeHeader(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function applyHeaderMap(
  fields: { key: string }[],
  headers: string[],
  saved: Record<string, string | null> | null | undefined,
  suggested: Record<string, number | null>,
): { mapping: Record<string, number | null>; applied: boolean } {
  const mapping = { ...suggested };
  if (!saved) return { mapping, applied: false };
  const normalized = headers.map(normalizeHeader);
  let applied = false;
  for (const field of fields) {
    const wanted = saved[field.key];
    if (typeof wanted !== "string" || !wanted.trim()) continue;
    const key = normalizeHeader(wanted);
    if (!key) continue;
    const index = normalized.findIndex((header) => header === key);
    if (index >= 0) {
      mapping[field.key] = index;
      applied = true;
    }
  }
  return { mapping, applied };
}

export function headerMapFromIndexes(fields: { key: string }[], headers: string[], mapping: Record<string, number | null>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const field of fields) {
    const index = mapping[field.key];
    out[field.key] = index == null || index < 0 || index >= headers.length ? null : (headers[index] ?? null);
  }
  return out;
}

export function defaultImportName(typeLabel: string, when = new Date()): string {
  const month = String(when.getMonth() + 1).padStart(2, "0");
  const day = String(when.getDate()).padStart(2, "0");
  return `${typeLabel} ${when.getFullYear()}-${month}-${day}`;
}

/** Sum one mapped column. Blank cells are skipped. A column with no numbers has no total. */
export function sumMappedField(rows: { mapped: Record<string, string> }[], field: string): number | null {
  let total = 0;
  let any = false;
  for (const row of rows) {
    const raw = row.mapped[field];
    if (raw == null || String(raw).trim() === "") continue;
    const value = Number(String(raw).replace(/[$,\s]/g, ""));
    if (!Number.isFinite(value)) continue;
    total += value;
    any = true;
  }
  if (!any) return null;
  return Math.round(total * 100) / 100;
}
