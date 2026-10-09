/** Pending QMS field edits. Row cells use the key `row:<id>:<column>`. */
export function groupDrafts(drafts: Iterable<[string, string]>): {
  fields: Array<[string, string]>;
  rows: Array<{ rowId: number; cols: Record<string, string> }>;
} {
  const fields: Array<[string, string]> = [];
  const rows = new Map<number, Record<string, string>>();
  for (const [key, value] of drafts) {
    const match = /^row:(\d+):([\s\S]+)$/.exec(key);
    if (!match) {
      fields.push([key, value]);
      continue;
    }
    const rowKey = match[1];
    const column = match[2];
    if (rowKey == null || column == null) continue;
    const rowId = Number(rowKey);
    const cols = rows.get(rowId) ?? {};
    cols[column] = value;
    rows.set(rowId, cols);
  }
  return { fields, rows: [...rows.entries()].map(([rowId, cols]) => ({ rowId, cols })) };
}
