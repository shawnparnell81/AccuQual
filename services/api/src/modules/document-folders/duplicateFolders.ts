/**
 * One-time fold of duplicate document folders.
 * Same name under the same parent always folds into the oldest row.
 * A department still sitting at the top level folds into the copy under ISO.
 * An empty leftover of a seed name that lives in only one place folds into
 * the older copy. Quality Manual under ISO and the older one under Quality
 * stay apart: the seed puts that name in two places on purpose.
 */

export interface MergeFolder {
  id: number;
  name: string;
  parentId: number | null;
  pdfPath?: string | null;
  documentId?: number | null;
  linkedPath?: string | null;
}

export interface FolderMerge {
  sourceId: number;
  destId: number;
}

export interface SeedNode {
  name: string;
  children: SeedNode[];
}

export interface DuplicateMergeOptions {
  singleHomeNames: ReadonlySet<string>;
  isoName: string;
  blankLibraryNames: readonly string[];
  mainIsoNames: readonly string[];
}

function savedItem(node: MergeFolder): boolean {
  return node.pdfPath != null || node.documentId != null || (node.linkedPath != null && node.linkedPath !== "");
}

function isContainer(node: MergeFolder, folders: MergeFolder[]): boolean {
  if (folders.some((folder) => folder.parentId === node.id)) return true;
  return !savedItem(node);
}

function childrenByParent(folders: MergeFolder[]): Map<number, MergeFolder[]> {
  const children = new Map<number, MergeFolder[]>();
  for (const folder of folders) {
    if (folder.parentId == null) continue;
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  return children;
}

function subtreeHasPayload(id: number, folders: MergeFolder[], children: Map<number, MergeFolder[]>): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const stack = [id];
  const seen = new Set<number>();
  while (stack.length > 0) {
    const current = stack.pop();
    if (current == null || seen.has(current)) continue;
    seen.add(current);
    const node = byId.get(current);
    if (node && savedItem(node)) return true;
    for (const child of children.get(current) ?? []) stack.push(child.id);
  }
  return false;
}

function inBlankLibrary(folder: MergeFolder, folders: MergeFolder[], names: readonly string[]): boolean {
  const byId = new Map(folders.map((row) => [row.id, row]));
  const blocked = new Set(names);
  let current: MergeFolder | undefined = folder;
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (blocked.has(current.name)) return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

function descendsFrom(folders: MergeFolder[], nodeId: number, ancestorId: number): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(nodeId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

/** Names the seeds place on exactly one path. A second copy of those is a leftover. */
export function singleHomeSeedNames(trees: SeedNode[], extraPaths: string[][]): Set<string> {
  const paths = new Map<string, Set<string>>();
  function walk(nodes: SeedNode[], prefix: string[]) {
    for (const node of nodes) {
      const path = [...prefix, node.name].join(" / ");
      const set = paths.get(node.name) ?? new Set<string>();
      set.add(path);
      paths.set(node.name, set);
      walk(node.children, [...prefix, node.name]);
    }
  }
  walk(trees, []);
  for (const path of extraPaths) {
    const name = path[path.length - 1];
    if (!name) continue;
    const set = paths.get(name) ?? new Set<string>();
    set.add(path.join(" / "));
    paths.set(name, set);
  }
  const single = new Set<string>();
  for (const [name, set] of paths) {
    if (set.size === 1) single.add(name);
  }
  return single;
}

export function planDuplicateFolderMerges(folders: MergeFolder[], options: DuplicateMergeOptions): FolderMerge[] {
  const merges: FolderMerge[] = [];
  const usedSources = new Set<number>();
  const children = childrenByParent(folders);
  const iso = folders.find((folder) => folder.parentId == null && folder.name === options.isoName);
  const mainIso = new Set(options.mainIsoNames);

  function add(sourceId: number, destId: number) {
    if (sourceId === destId || usedSources.has(sourceId) || usedSources.has(destId)) return;
    if (descendsFrom(folders, destId, sourceId)) return;
    usedSources.add(sourceId);
    merges.push({ sourceId, destId });
  }

  const containers = folders.filter(
    (folder) => isContainer(folder, folders) && folder.name !== "Library Pool" && folder.name !== options.isoName,
  );

  const sameParent = new Map<string, MergeFolder[]>();
  for (const folder of containers) {
    const key = `${folder.parentId ?? "root"}\0${folder.name}`;
    const list = sameParent.get(key) ?? [];
    list.push(folder);
    sameParent.set(key, list);
  }
  for (const group of sameParent.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.id - b.id);
    const dest = sorted[0];
    if (!dest) continue;
    for (const source of sorted.slice(1)) add(source.id, dest.id);
  }

  const outsideLibrary = containers.filter(
    (folder) => !usedSources.has(folder.id) && !inBlankLibrary(folder, folders, options.blankLibraryNames),
  );
  const byName = new Map<string, MergeFolder[]>();
  for (const folder of outsideLibrary) {
    const list = byName.get(folder.name) ?? [];
    list.push(folder);
    byName.set(folder.name, list);
  }

  for (const [name, copies] of byName) {
    if (!options.singleHomeNames.has(name)) continue;
    const eligible = copies.filter((folder) => !usedSources.has(folder.id));
    if (eligible.length < 2) continue;
    const withPayload = eligible.filter((folder) => subtreeHasPayload(folder.id, folders, children)).sort((a, b) => a.id - b.id);
    const dest = withPayload[0] ?? [...eligible].sort((a, b) => a.id - b.id)[0];
    if (!dest) continue;
    for (const source of eligible) {
      if (source.id === dest.id || usedSources.has(source.id)) continue;
      if (mainIso.has(source.name) && iso && source.parentId === iso.id) continue;
      if (subtreeHasPayload(source.id, folders, children)) continue;
      add(source.id, dest.id);
    }
  }

  if (iso) {
    for (const [name, copies] of byName) {
      if (name === options.isoName) continue;
      const roots = copies.filter((folder) => folder.parentId == null && !usedSources.has(folder.id)).sort((a, b) => a.id - b.id);
      if (roots.length === 0) continue;
      const underIso = copies.filter((folder) => folder.parentId === iso.id).sort((a, b) => a.id - b.id);
      const kept = underIso.find((folder) => !usedSources.has(folder.id));
      const foldedInto = underIso
        .map((folder) => merges.find((move) => move.sourceId === folder.id)?.destId)
        .find((destId) => destId != null);
      const dest = kept ?? (foldedInto == null ? undefined : folders.find((folder) => folder.id === foldedInto));
      if (!dest) continue;
      for (const source of roots) add(source.id, dest.id);
    }
  }

  return merges;
}
