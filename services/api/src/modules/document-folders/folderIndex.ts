/**
 * Lookups over one folder list, built once per list instead of once per row.
 * Filing passes treat lists as values (each change makes a new array), so an
 * index keyed on the array stays valid. The length check rebuilds it if a
 * caller ever appends in place.
 */
interface FolderLike {
  id: number;
  parentId: number | null;
}

interface FolderIndex<T extends FolderLike> {
  length: number;
  byId: Map<number, T>;
  parents: Set<number>;
}

const cache = new WeakMap<readonly FolderLike[], FolderIndex<FolderLike>>();

function indexOf<T extends FolderLike>(folders: readonly T[]): FolderIndex<T> {
  const hit = cache.get(folders);
  if (hit && hit.length === folders.length) return hit as unknown as FolderIndex<T>;
  const byId = new Map<number, T>();
  const parents = new Set<number>();
  for (const folder of folders) {
    byId.set(folder.id, folder);
    if (folder.parentId != null) parents.add(folder.parentId);
  }
  const built = { length: folders.length, byId, parents };
  cache.set(folders, built as unknown as FolderIndex<FolderLike>);
  return built;
}

export function folderById<T extends FolderLike>(folders: readonly T[]): Map<number, T> {
  return indexOf(folders).byId;
}

export function hasChildren(folders: readonly FolderLike[], id: number): boolean {
  return indexOf(folders).parents.has(id);
}
