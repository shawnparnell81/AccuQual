import type { CellValue } from "./isoFormLogic";

/** A cell the sheet can render. Objects stay as text so a later save does not drop them. */
export function isoCell(value: unknown): CellValue {
  if (value == null || typeof value === "string" || typeof value === "boolean") return value as CellValue;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function isoCells(value: unknown): Record<string, CellValue> {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const cells: Record<string, CellValue> = {};
  for (const [key, cell] of Object.entries(source)) cells[key] = isoCell(cell);
  return cells;
}

export function isoList<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/** `data` is sometimes returned as a JSON string. Unreadable text stays unset. */
export function isoDataBag(data: unknown): Record<string, unknown> | null {
  let value = data;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    try {
      value = JSON.parse(trimmed) as unknown;
    } catch {
      return null;
    }
  }
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}
