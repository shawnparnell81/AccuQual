import { folderChain, saveAsFolders, type BrowseFolder } from "./folderBrowse";

export interface FolderChoice {
  id: number;
  path: string;
}

/** "Documents > ISO Compliance Documents > Quality > FAI / Validation": what the save confirmation shows. */
export function folderPathLabel<T extends BrowseFolder>(folders: T[], folderId: number): string {
  return ["Documents", ...folderChain(folders, folderId).map((folder) => folder.name)].join(" > ");
}

/**
 * Folders a new report can be saved into, from the live folder list (so a folder made a minute ago is there), sorted by path.
 * The list is the one the server gave this user, so folders they cannot see are not offered.
 */
export function createFolderChoices<T extends BrowseFolder>(folders: T[]): FolderChoice[] {
  return saveAsFolders(folders)
    .map((folder) => ({ id: folder.id, path: folderPathLabel(folders, folder.id) }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** The folder the dialog starts on: the folder being viewed, when it is a place a report can go. */
export function defaultCreateFolder(choices: FolderChoice[], currentFolderId: number | null | undefined): number | "" {
  return currentFolderId != null && choices.some((choice) => choice.id === currentFolderId) ? currentFolderId : "";
}
