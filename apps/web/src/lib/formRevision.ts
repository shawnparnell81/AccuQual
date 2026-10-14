export const MAX_REVISION = 10;

/** The message under the New revision box, or null when it is fine to submit. */
export function newRevisionProblem(current: string, typed: string): string | null {
  const text = typed.trim();
  if (!text || text.toLowerCase() === current.trim().toLowerCase()) return `Enter the new revision. It must be different from REV ${current}.`;
  if (text.length > MAX_REVISION) return `The revision can be at most ${MAX_REVISION} characters.`;
  return null;
}

/** Draft, Pending approval, or Live REV X: the words the editor and the list both show. */
export function formStatusLabel(form: { status: string; revision: string; pendingRevision: string | null }): string {
  if (form.pendingRevision) {
    return form.status === "published" ? `Live REV ${form.revision} · REV ${form.pendingRevision} pending approval` : `Pending approval · REV ${form.pendingRevision}`;
  }
  return form.status === "published" ? `Live REV ${form.revision}` : "Draft";
}
