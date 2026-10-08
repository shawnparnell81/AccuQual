import { folderChain, type BrowseFolder } from "./folderBrowse";

/** Copyable path. Crumbs already include the Documents root when they come from explorerCrumbs. */
export function folderPathLabel(names: readonly string[]): string {
  return names.map((name) => name.trim()).filter((name) => name.length > 0).join(" / ");
}

export function subtreeIds(folders: readonly { id: number; parentId: number | null }[], rootId: number): Set<number> {
  const ids = new Set<number>([rootId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const folder of folders) {
      if (folder.parentId != null && ids.has(folder.parentId) && !ids.has(folder.id)) {
        ids.add(folder.id);
        grew = true;
      }
    }
  }
  return ids;
}

/** Folders a delete can move contents into. The folder being deleted, and everything inside it, are left out. */
export function retireDestinationChoices<T extends BrowseFolder>(folders: readonly T[], folderId: number): T[] {
  const blocked = subtreeIds(folders, folderId);
  return folders.filter((folder) => !blocked.has(folder.id) && folder.name !== "Library Pool");
}

export function defaultRetireDestinationId(folders: readonly { id: number; parentId: number | null }[], folderId: number): number | null {
  return folders.find((folder) => folder.id === folderId)?.parentId ?? null;
}

const BLANK_DRAWERS = new Set(["Blank Forms Templates", "Blank Form Templates"]);

/** Saved forms are not filed into the blank-template drawer. */
export function isBlankLibraryFolder(folders: readonly BrowseFolder[], folderId: number): boolean {
  return folderChain([...folders], folderId).some((folder) => BLANK_DRAWERS.has(folder.name));
}

export function documentFolderHasContents(folder: BrowseFolder, folders: readonly BrowseFolder[]): boolean {
  if (folders.some((row) => row.parentId === folder.id)) return true;
  return folder.pdfPath != null || folder.documentId != null || (folder.linkedPath != null && folder.linkedPath !== "");
}
