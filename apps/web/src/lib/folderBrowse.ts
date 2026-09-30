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

/** Real Documents folders a filled copy can be saved into. */
export function saveAsFolders<T extends BrowseFolder>(folders: T[]): T[] {
  const hidden = templateLibraryIds(folders);
  return folders.filter((folder) => !hidden.has(folder.id) && isFolderEntry(folders, folder));
}

/** A row you can open as a folder. A leaf with a record, file, or controlled document is a file. */
export function isFolderEntry<T extends BrowseFolder>(folders: T[], node: T): boolean {
  if (folders.some((folder) => folder.parentId === node.id)) return true;
  return !(node.linkedPath || node.pdfPath || node.documentId != null);
}

export function listFolder<T extends BrowseFolder>(folders: T[], folderId: number | null): { folders: T[]; files: T[] } {
  const children = childrenOf(folders, folderId);
  return {
    folders: children.filter((node) => isFolderEntry(folders, node)),
    files: children.filter((node) => !isFolderEntry(folders, node)),
  };
}

/** Where a click on this row goes. Null when the row is only a name. */
export function openTarget(node: BrowseFolder): string | null {
  if (node.linkedPath) return node.linkedPath;
  if (node.documentId != null) return `/documents/${node.documentId}`;
  return null;
}

/** The folder a filled copy was filed in. Null until it has a parent folder. */
export function filingLocation(parentId: number | null, parentPath: string[], fileName: string | null): FiledLocation | null {
  if (parentId == null || parentPath.length === 0) return null;
  return { path: parentPath.join(" / "), folderId: parentId, fileName };
}
