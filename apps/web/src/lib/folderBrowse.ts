/**
 * How Folder Explorer opens a folder and how a save message points at it.
 * A filled form is one folder row with a linkedPath back to that record.
 */

export interface BrowseFolder {
  id: number;
  name: string;
  parentId: number | null;
  sortOrder: number;
  linkedPath?: string | null;
  pdfPath?: string | null;
  documentId?: number | null;
}

export interface FiledLocation {
  path: string;
  folderId: number;
  fileName: string | null;
}

/** Documents page opened on one folder. Save uses this as "Open folder". */
export function documentsFolderHref(folderId: number): string {
  return `/documents/folders?folder=${folderId}`;
}

/** Root-first chain for breadcrumbs. Stops if the tree loops. */
export function folderChain<T extends BrowseFolder>(folders: T[], folderId: number): T[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const chain: T[] = [];
  let current = byId.get(folderId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    chain.unshift(current);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return chain;
}

function childrenOf<T extends BrowseFolder>(folders: T[], parentId: number | null): T[] {
  return folders
    .filter((folder) => folder.parentId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Blank masters live here. Save as does not offer this folder, so a filled copy is not filed as another blank. */
export const BLANK_FORM_TEMPLATES_FOLDER = "Blank Form Templates";

/**
 * Original layout drawer whose children are empty form names (NCR Form, 8D Form, and the rest).
 * Those blanks belong on Blank Forms / QMS Forms. Folder Explorer does not list the empty shells.
 */
export const SEEDED_FORMS_DRAWER = "Forms & Templates";

/** A module home or blank route, such as `/ncr` or `/qms-forms/document_revision_record`. A saved copy has a record id, or is the single Pareto chart. */
export function isFiledRecordPath(linkedPath: string | null | undefined): boolean {
  if (!linkedPath) return false;
  if (linkedPath === "/pareto") return true;
  return /\/\d+(?:\/|$)/.test(linkedPath);
}

/** Uploaded file, controlled document, or a form someone Saved into this folder. A shortcut to a blank module is not saved work. */
export function isSavedDocument<T extends BrowseFolder>(node: T): boolean {
  return Boolean(node.pdfPath || node.documentId != null || isFiledRecordPath(node.linkedPath));
}

function childrenByParent<T extends BrowseFolder>(folders: T[]): Map<number, T[]> {
  const children = new Map<number, T[]>();
  for (const folder of folders) {
    if (folder.parentId == null) continue;
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  return children;
}

function hideTree<T extends BrowseFolder>(children: Map<number, T[]>, hidden: Set<number>, id: number) {
  if (hidden.has(id)) return;
  hidden.add(id);
  for (const child of children.get(id) ?? []) hideTree(children, hidden, child.id);
}

/**
 * Blank-template drawers, and the original Forms & Templates shells, leave Folder Explorer.
 * A drawer stays when it holds a saved file or a saved form, so real work is not dropped.
 */
export function explorerHiddenIds<T extends BrowseFolder>(folders: T[]): Set<number> {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const children = childrenByParent(folders);
  const hidden = new Set<number>();

  function subtreeHasSaved(id: number, seen: Set<number>): boolean {
    if (seen.has(id)) return false;
    seen.add(id);
    const node = byId.get(id);
    if (node && isSavedDocument(node)) return true;
    return (children.get(id) ?? []).some((child) => subtreeHasSaved(child.id, seen));
  }

  function hideUnsavedBranch(id: number) {
    const seen = new Set<number>();
    if (!subtreeHasSaved(id, seen)) {
      hideTree(children, hidden, id);
      return;
    }
    for (const child of children.get(id) ?? []) {
      if (!subtreeHasSaved(child.id, new Set())) hideTree(children, hidden, child.id);
      else hideUnsavedBranch(child.id);
    }
  }

  for (const folder of folders) {
    if (folder.name === BLANK_FORM_TEMPLATES_FOLDER || folder.name === SEEDED_FORMS_DRAWER) hideUnsavedBranch(folder.id);
  }
  return hidden;
}

/** Folder rows Folder Explorer is allowed to show. */
export function visibleExplorerFolders<T extends BrowseFolder>(folders: T[]): T[] {
  const hidden = explorerHiddenIds(folders);
  return folders.filter((folder) => !hidden.has(folder.id));
}

/** This folder and everything nested under a blank-template library. */
export function templateLibraryIds<T extends BrowseFolder>(folders: T[]): Set<number> {
  const hidden = new Set<number>();
  const stack = folders.filter((folder) => folder.name === BLANK_FORM_TEMPLATES_FOLDER).map((folder) => folder.id);
  for (let index = 0; index < stack.length; index += 1) {
    const parentId = stack[index]!;
    if (hidden.has(parentId)) continue;
    hidden.add(parentId);
    for (const folder of folders) {
      if (folder.parentId === parentId) stack.push(folder.id);
    }
  }
  return hidden;
}

/** Real Documents folders a filled copy can be saved into. Blank drawers are not in the list. */
export function saveAsFolders<T extends BrowseFolder>(folders: T[]): T[] {
  const hidden = explorerHiddenIds(folders);
  return folders.filter((folder) => !hidden.has(folder.id) && isFolderEntry(folders, folder));
}

/** A row you can open as a folder. A saved form, upload, or controlled document is a file. A shortcut to a blank module stays a folder. */
export function isFolderEntry<T extends BrowseFolder>(folders: T[], node: T): boolean {
  if (folders.some((folder) => folder.parentId === node.id)) return true;
  return !isSavedDocument(node);
}

export function listFolder<T extends BrowseFolder>(folders: T[], folderId: number | null): { folders: T[]; files: T[] } {
  const children = childrenOf(folders, folderId);
  return {
    folders: children.filter((node) => isFolderEntry(folders, node)),
    files: children.filter((node) => !isFolderEntry(folders, node)),
  };
}

/** Where a click on a saved row goes. A blank-module shortcut is not an openable file. */
export function openTarget(node: BrowseFolder): string | null {
  if (node.linkedPath && isFiledRecordPath(node.linkedPath)) return node.linkedPath;
  if (node.documentId != null) return `/documents/${node.documentId}`;
  return null;
}

/** The folder a filled copy was filed in. Null until it has a parent folder. */
export function filingLocation(parentId: number | null, parentPath: string[], fileName: string | null): FiledLocation | null {
  if (parentId == null || parentPath.length === 0) return null;
  return { path: parentPath.join(" / "), folderId: parentId, fileName };
}
