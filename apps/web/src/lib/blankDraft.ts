/** These starts stay in the browser until the first real Save. */
export const DEFERRED_CREATE_PATHS = ["/validation-reports", "/iso-quality-forms", "/qms-forms"] as const;

export type DeferredCreatePath = (typeof DEFERRED_CREATE_PATHS)[number];

export interface BlankDraft {
  createPath: DeferredCreatePath;
  body: Record<string, unknown>;
}

export function isDeferredCreatePath(path: string): path is DeferredCreatePath {
  return (DEFERRED_CREATE_PATHS as readonly string[]).includes(path);
}

export function blankDraftState(start: { createPath: string; body: unknown }): { freshForm: true; blankDraft: BlankDraft } | null {
  if (!isDeferredCreatePath(start.createPath)) return null;
  const body = start.body && typeof start.body === "object" ? (start.body as Record<string, unknown>) : {};
  return { freshForm: true, blankDraft: { createPath: start.createPath, body } };
}

/** Open path for a blank that has not been saved. `{id}` becomes `new`. */
export function unsavedBlankPath(openPath: string): string {
  return openPath.replaceAll("{id}", "new");
}

export function readBlankDraft(state: unknown, createPath: DeferredCreatePath): BlankDraft | null {
  if (!state || typeof state !== "object") return null;
  const draft = (state as { blankDraft?: unknown }).blankDraft;
  if (!draft || typeof draft !== "object") return null;
  const row = draft as { createPath?: unknown; body?: unknown };
  if (row.createPath !== createPath) return null;
  const body = row.body && typeof row.body === "object" ? (row.body as Record<string, unknown>) : {};
  return { createPath, body };
}

/**
 * Rebuilds the unsaved blank from Blank Forms Templates by formKey.
 * Used when router state is gone: workspace tabs render each page with `state: null`, and a refresh drops it.
 * Never writes anything; works the same whether the form folder has zero or many saved copies.
 */
export function blankDraftFromTemplates(
  formKey: string | null | undefined,
  templates: ReadonlyArray<{ formKey: string; start?: { createPath: string; body: unknown } | null }> | undefined,
  createPath: DeferredCreatePath,
): BlankDraft | null {
  if (!formKey || !templates) return null;
  const start = templates.find((t) => t.formKey === formKey)?.start;
  if (!start || start.createPath !== createPath) return null;
  return blankDraftState(start)?.blankDraft ?? null;
}
