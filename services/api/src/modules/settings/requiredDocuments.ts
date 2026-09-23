/**
 * feasibilitySettings.requiredDocuments stores controlled-document ids
 * (documents.id) as decimal strings inside the existing jsonb string array.
 * Older rows may hold a single string, a bare number, or free-text names
 * from the previous tag editor. Reads coerce that into a de-duplicated id
 * list and drop anything that is not an id; writes still reject unknown,
 * deleted, and duplicate ids (see assertAccessibleRequiredDocuments).
 */
export const REQUIRED_DOCUMENT_ID = /^[1-9]\d*$/;

export function normalizeRequiredDocumentIds(value: unknown): string[] {
  const raw = Array.isArray(value) ? value : value == null || value === "" ? [] : [value];
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const id = canonicalDocumentId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

function canonicalDocumentId(item: unknown): string | null {
  if (typeof item === "number" && Number.isInteger(item) && item > 0) return String(item);
  if (typeof item === "string" && REQUIRED_DOCUMENT_ID.test(item.trim())) return item.trim();
  return null;
}
