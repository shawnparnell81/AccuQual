/**
 * Record id for GET /attachments. A positive integer is a real parent row.
 * Values such as "1:0" and "2:0" are sheet composites and are not sent.
 */
export function attachmentParentId(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return Number(value);
  return null;
}
