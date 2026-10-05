export interface LinkedDocumentRef {
  id: number;
  title: string;
}

export function parseLinkedDocuments(value: unknown): LinkedDocumentRef[] {
  if (!Array.isArray(value)) return [];
  const out: LinkedDocumentRef[] = [];
  const seen = new Set<number>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const id = Number((item as { id?: unknown }).id);
    const title = (item as { title?: unknown }).title;
    if (!Number.isInteger(id) || id < 1 || typeof title !== "string" || !title.trim()) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, title: title.trim() });
  }
  return out;
}

/** Replaces one step's document list and leaves every other process field in place. */
export function writeStepDocuments(processData: unknown, step: string, documents: LinkedDocumentRef[]): Record<string, unknown> {
  const data = processData && typeof processData === "object" && !Array.isArray(processData) ? { ...(processData as Record<string, unknown>) } : {};
  const current = data.stepDocuments && typeof data.stepDocuments === "object" && !Array.isArray(data.stepDocuments) ? { ...(data.stepDocuments as Record<string, unknown>) } : {};
  current[step] = documents;
  data.stepDocuments = current;
  return data;
}
