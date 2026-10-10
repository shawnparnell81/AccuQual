/**
 * Same folder aside from capitalization, extra spaces, underscores, and a
 * leading number from an old Windows export (`01 Quality Manual`, `01_Quality_Manual`).
 * `8D` stays `8d`: the digits are the name, not a prefix.
 * Matches services/api/src/modules/document-folders/duplicateFolders.ts.
 */
export function folderIdentityKey(name: string): string {
  const collapsed = name.trim().replace(/[_]+/g, " ").replace(/\s+/g, " ");
  const stripped = collapsed.replace(/^\d{1,3}[\s.-]+/, "");
  return stripped.trim().replace(/\s+/g, " ").toLowerCase();
}

export function folderNameTaken(name: string, siblingNames: readonly string[]): boolean {
  const key = folderIdentityKey(name);
  if (!key) return false;
  return siblingNames.some((sibling) => folderIdentityKey(sibling) === key);
}
