/**
 * One-time fold so each folder name sits in one place.
 * Same name under the same parent folds into the oldest row.
 * A name that also lives somewhere else folds into its one home:
 * a main ISO drawer stays directly under ISO Compliance Documents,
 * and any other repeated seed name stays on the path listed in
 * CANONICAL_FOLDER_HOMES. A deleted main drawer is not recreated;
 * the remaining copy is the home. Blank Forms Templates keeps every
 * blank. A topic there is not folded into a company folder. The older
 * Blank Form Templates drawer is left alone: the living Quality Manual
 * lists stay there until their own change.
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
  isoName: string;
  /** Topic shelf. Its folders stay put and are not folded into a company folder. */
  blankShelfNames: readonly string[];
  /** Hidden drawer that is not folded. Living lists stay on it. */
  legacyDrawerNames: readonly string[];
  mainIsoNames: readonly string[];
  /** Parent path for a name that the seeds used to plant in more than one place. */
  canonicalHomes: Readonly<Record<string, readonly string[]>>;
}

/**
 * The one parent path each formerly repeated seed name keeps.
 * Main drawers sit directly under ISO. The others keep the Quality
 * drawer that already files that record, and the extra Engineering
 * or Records copy is the one that folds in.
 */
export const CANONICAL_FOLDER_HOMES: Readonly<Record<string, readonly string[]>> = {
  "Quality Manual": ["ISO Compliance Documents"],
  Procedures: ["ISO Compliance Documents"],
  "Engineering Standards": ["ISO Compliance Documents"],
  "Calibration Certificates": ["ISO Compliance Documents", "Quality", "Calibration & Equipment"],
  "Equipment Master List": ["ISO Compliance Documents", "Quality", "Calibration & Equipment"],
  "Training Records": ["ISO Compliance Documents", "Quality", "Training & Competency"],
  PFMEA: ["ISO Compliance Documents", "Quality", "Risk Management"],
  "Control Plans": ["ISO Compliance Documents", "Quality", "Risk Management"],
  "Process Flow Diagrams": ["ISO Compliance Documents", "Quality", "Risk Management"],
};

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

function ancestorNames(folders: MergeFolder[], id: number): string[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current = byId.get(id);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return names;
}

function parentPath(folders: MergeFolder[], folder: MergeFolder): string[] {
  if (folder.parentId == null) return [];
  return ancestorNames(folders, folder.parentId);
}

function samePath(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((name, index) => name === right[index]);
}

function byId(a: MergeFolder, b: MergeFolder): number {
  return a.id - b.id;
}

/** Every path the seeds give a name, including the 14 main drawers under ISO. */
export function seededFolderPaths(trees: SeedNode[], extraPaths: string[][]): Map<string, string[]> {
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
  return new Map([...paths.entries()].map(([name, set]) => [name, [...set].sort()]));
}

/** Seed names that still appear on more than one path. Empty once each name has one home. */
export function repeatedSeedFolderNames(trees: SeedNode[], extraPaths: string[][]): string[] {
  return [...seededFolderPaths(trees, extraPaths).entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(([name]) => name)
    .sort((a, b) => a.localeCompare(b));
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
    const sorted = [...group].sort(byId);
    const dest = sorted[0];
    if (!dest) continue;
    for (const source of sorted.slice(1)) add(source.id, dest.id);
  }

  const listed = containers.filter(
    (folder) =>
      !usedSources.has(folder.id) &&
      !inBlankLibrary(folder, folders, options.legacyDrawerNames) &&
      !inBlankLibrary(folder, folders, options.blankShelfNames),
  );
  const byName = new Map<string, MergeFolder[]>();
  for (const folder of listed) {
    const list = byName.get(folder.name) ?? [];
    list.push(folder);
    byName.set(folder.name, list);
  }

  for (const [name, copies] of byName) {
    const eligible = copies.filter((folder) => !usedSources.has(folder.id));
    if (eligible.length < 2) continue;
    const underIso = iso ? eligible.filter((folder) => folder.parentId === iso.id).sort(byId) : [];
    const home = options.canonicalHomes[name];
    const atHome = home ? eligible.filter((folder) => samePath(parentPath(folders, folder), home)).sort(byId) : [];
    const withPayload = eligible.filter((folder) => subtreeHasPayload(folder.id, folders, children)).sort(byId);
    const oldest = [...eligible].sort(byId);
    let dest: MergeFolder | undefined;
    if (mainIso.has(name)) {
      dest = underIso[0] ?? atHome[0] ?? withPayload[0] ?? oldest[0];
    } else {
      dest = atHome[0] ?? underIso[0] ?? withPayload[0] ?? oldest[0];
    }
    if (!dest) continue;
    for (const source of eligible) {
      if (source.id === dest.id) continue;
      add(source.id, dest.id);
    }
  }

  return merges;
}

/** Appended when a blank-topic folder uses a name a company folder already has. */
export const BLANK_TOPIC_FORMS_SUFFIX = " Forms";

export interface BlankTopicRename {
  folderId: number;
  fromName: string;
  toName: string;
}

export interface BlankShortcutReturn {
  shortcutId: number;
  formKey: string;
  topic: string;
  folderName: string;
}

/** Container names that are not inside a blank drawer. Those are the names a topic must not repeat. */
export function namesOutsideBlankDrawers(folders: MergeFolder[], drawerNames: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const folder of folders) {
    if (inBlankLibrary(folder, folders, drawerNames)) continue;
    if (!isContainer(folder, folders)) continue;
    names.add(folder.name);
  }
  return names;
}

/** Shelf folder name for one topic. A clash keeps the blank and changes the folder name. */
export function blankTopicFolderName(topic: string, outsideNames: ReadonlySet<string>): string {
  return outsideNames.has(topic) ? `${topic}${BLANK_TOPIC_FORMS_SUFFIX}` : topic;
}

/**
 * Direct children of the blank shelf whose name is already a company folder.
 * Topics that do not clash are left as they are. The hidden living-list drawer
 * is not a shelf id, so its folders are not renamed.
 */
export function planBlankTopicRenames(
  folders: MergeFolder[],
  shelfId: number,
  topics: readonly string[],
  drawerNames: readonly string[],
): BlankTopicRename[] {
  const outside = namesOutsideBlankDrawers(folders, drawerNames);
  const topicNames = new Set(topics);
  const renames: BlankTopicRename[] = [];
  for (const folder of folders) {
    if (folder.parentId !== shelfId) continue;
    if (!topicNames.has(folder.name)) continue;
    if (!isContainer(folder, folders)) continue;
    const toName = blankTopicFolderName(folder.name, outside);
    if (toName === folder.name) continue;
    renames.push({ folderId: folder.id, fromName: folder.name, toName });
  }
  return renames.sort((a, b) => a.folderId - b.folderId);
}

function insideFolder(folders: MergeFolder[], nodeId: number, ancestorId: number): boolean {
  if (nodeId === ancestorId) return true;
  return descendsFrom(folders, nodeId, ancestorId);
}

/** Blank shortcuts that sit outside Blank Forms Templates, with the shelf folder they go back to. */
export function planBlankShortcutReturns(
  folders: MergeFolder[],
  shelfId: number,
  formKeyOf: (folder: MergeFolder) => string | null,
  topicOf: (formKey: string) => string | null,
  outsideNames: ReadonlySet<string>,
): BlankShortcutReturn[] {
  const planned: BlankShortcutReturn[] = [];
  for (const folder of folders) {
    const formKey = formKeyOf(folder);
    if (!formKey) continue;
    if (insideFolder(folders, folder.id, shelfId)) continue;
    const topic = topicOf(formKey);
    if (!topic) continue;
    planned.push({
      shortcutId: folder.id,
      formKey,
      topic,
      folderName: blankTopicFolderName(topic, outsideNames),
    });
  }
  return planned.sort((a, b) => a.shortcutId - b.shortcutId);
}
