/**
 * CONFIDENTIAL and CUSTOMER CONFIDENTIAL are printed only when a record
 * already carries that exact marking. A narrative that happens to use the
 * word is not a marking. Status words such as Draft stay on the status watermark.
 */

const MARKING_KEYS = ["marking", "confidentiality", "distribution", "documentMarking", "securityMarking", "tags"] as const;

export type RecordMarking = "CONFIDENTIAL" | "CUSTOMER CONFIDENTIAL";

export function canonicalMarking(value: unknown): RecordMarking | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = canonicalMarking(item);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase().replace(/\s+/g, " ");
  if (text === "CUSTOMER CONFIDENTIAL") return "CUSTOMER CONFIDENTIAL";
  if (text === "CONFIDENTIAL") return "CONFIDENTIAL";
  return null;
}

/** Reads an existing marking field or tag. Does not scan the rest of the record. */
export function markingFromRecord(data: unknown): RecordMarking | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const record = data as Record<string, unknown>;
  for (const key of MARKING_KEYS) {
    const found = canonicalMarking(record[key]);
    if (found) return found;
  }
  return null;
}
