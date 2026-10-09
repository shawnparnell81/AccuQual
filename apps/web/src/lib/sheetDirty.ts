/** A sheet is dirty only when it differs from the snapshot taken on load or after the last successful save. */
export function sheetIsDirty(recordId: number, liveSnap: string, savedSnap: { id: number; snap: string } | null): boolean {
  if (savedSnap == null || savedSnap.id !== recordId) return false;
  return liveSnap !== savedSnap.snap;
}

/** Stable text for the fields a sheet edits. Key order is ignored so a reload cannot look unsaved. */
export function sheetSnap(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortValue((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}
