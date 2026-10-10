import { ISO_TYPE_TO_FORM_KEY } from "../document-folders/editableForms.js";

/** Stored form_type, or a form key such as frm-ncr-001, as the type the sheet knows. */
export function canonicalIsoFormType(stored: unknown): string {
  const text = typeof stored === "string" ? stored.trim() : "";
  if (!text) return "";
  if (Object.prototype.hasOwnProperty.call(ISO_TYPE_TO_FORM_KEY, text)) return text;
  const key = text.toLowerCase();
  const match = Object.entries(ISO_TYPE_TO_FORM_KEY).find(([, formKey]) => formKey === key);
  return match?.[0] ?? text;
}

function primitiveCell(value: unknown): string | number | boolean | null {
  if (value == null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Makes sheet data safe to render. Cell objects become text so they survive a
 * later save. A list that is not a list is left untouched. Invalid JSON throws
 * so the caller does not replace the row with an empty form.
 */
export function normalizeIsoFormData(data: unknown): Record<string, unknown> {
  let value = data;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return {};
    value = JSON.parse(trimmed) as unknown;
  }
  if (value == null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw new Error("ISO form data is not an object");
  const record = { ...(value as Record<string, unknown>) };
  if ("cells" in record && record.cells != null) {
    if (typeof record.cells !== "object" || Array.isArray(record.cells)) throw new Error("ISO form cells are not an object");
    const cells: Record<string, string | number | boolean | null> = {};
    for (const [key, cell] of Object.entries(record.cells as Record<string, unknown>)) cells[key] = primitiveCell(cell);
    record.cells = cells;
  }
  return record;
}
