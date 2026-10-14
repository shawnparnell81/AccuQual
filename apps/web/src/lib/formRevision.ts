export const MAX_REVISION = 10;

/** The message under the New revision box, or null when it is fine to submit. */
export function newRevisionProblem(current: string, typed: string): string | null {
  const text = typed.trim();
  if (!text || text.toLowerCase() === current.trim().toLowerCase()) return `Enter the new revision. It must be different from REV ${current}.`;
  if (text.length > MAX_REVISION) return `The revision can be at most ${MAX_REVISION} characters.`;
  return null;
}
