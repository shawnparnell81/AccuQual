export interface InspectionFailureRow {
  measurement: string;
  spec: string;
  actual: string;
}

const FAIL = /^(fail|failed|reject|rejected)$/i;

function text(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return "";
}

function walk(value: unknown, rows: InspectionFailureRow[], seen: Set<unknown>): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, rows, seen);
    return;
  }
  const record = value as Record<string, unknown>;
  const result = text(record, ["result", "status", "attributeResult"]);
  if (FAIL.test(result)) {
    const measurement = text(record, ["name", "parameter", "characteristic", "requirement", "label", "description", "item"]);
    if (measurement) {
      rows.push({
        measurement: measurement.slice(0, 300),
        spec: (text(record, ["specification", "spec", "specifiedLimits", "nominal", "tolerance", "requirement"]) || "(blank)").slice(0, 300),
        actual: (text(record, ["actual", "actualFinding", "actualResult", "measured", "evidence"]) || result).slice(0, 300),
      });
    }
  }
  for (const [key, child] of Object.entries(record)) {
    if (key === "linkedNcrs" || key.startsWith("_")) continue;
    walk(child, rows, seen);
  }
}

/** Failed checklist rows inside a picture-form inspection. */
export function collectInspectionFailures(value: unknown): InspectionFailureRow[] {
  const rows: InspectionFailureRow[] = [];
  walk(value, rows, new Set());
  return rows.slice(0, 40);
}
