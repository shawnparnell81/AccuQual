/** Keys added and removed when a role's permission list is saved. The stored value stays an explicit list of keys. */
export function permissionDiff(before: readonly string[], after: readonly string[]): { granted: string[]; revoked: string[] } {
  const beforeSet = new Set(before);
  const afterSet = new Set(after);
  return {
    granted: after.filter((key) => !beforeSet.has(key)),
    revoked: before.filter((key) => !afterSet.has(key)),
  };
}
