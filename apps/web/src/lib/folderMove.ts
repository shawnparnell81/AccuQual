export interface FolderNode {
  id: number;
  parentId: number | null;
}

/** True when `targetParentId` is the folder itself or one of its descendants. Null is the top level. */
export function folderMoveIsBlocked(folders: FolderNode[], folderId: number, targetParentId: number | null): boolean {
  if (targetParentId === null) return false;
  if (targetParentId === folderId) return true;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  if (!byId.has(targetParentId) || !byId.has(folderId)) return true;
  let cursor: number | null = targetParentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

export function nextSortOrder(folders: { parentId: number | null; sortOrder: number; id: number }[], parentId: number | null, movingId: number): number {
  const siblings = folders.filter((folder) => folder.parentId === parentId && folder.id !== movingId);
  return siblings.reduce((max, folder) => Math.max(max, folder.sortOrder), -1) + 1;
}
