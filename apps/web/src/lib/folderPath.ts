import type { BrowseFolder } from "./folderBrowse";
import { folderChain } from "./folderBrowse";
import { recordSurface } from "./recordSurface";

/** In-app folder path, using the same backslashes as the owner's X: drive and the real folder names. */
export function joinFolderPath(parts: string[]): string {
  return parts.map((part) => part.trim()).filter(Boolean).join("\\");
}

/** Full path of one folder row, including its own name. */
export function folderNodePath<T extends BrowseFolder>(folders: T[], folderId: number): string {
  return joinFolderPath(folderChain(folders, folderId).map((folder) => folder.name));
}

/** A label that is only "Location" or "Location:". */
export function isExactLocationLabel(text: string): boolean {
  return /^location\s*:?\s*$/i.test(text.trim());
}

/** A workbook cell whose text starts with "Location:". */
export function isLocationLine(text: string): boolean {
  return /^location\s*:/i.test(text.trim());
}

/**
 * Value to write into an empty Location answer. A value that is already there is left alone.
 * Returns null when there is nothing to insert.
 */
export function locationAnswerInsert(current: string | undefined, path: string): string | null {
  if ((current ?? "").trim()) return null;
  const next = path.trim();
  return next || null;
}

/**
 * What Insert current path writes into a grid cell.
 * An answer that already has text is not replaced. A Location line keeps its "Location:" prefix.
 */
export function gridLocationInsert(cellValue: string, currentAnswer: string | undefined, path: string, neighborIsLocationLabel: boolean): string | null {
  const next = locationAnswerInsert(currentAnswer, path);
  if (!next) return null;
  if (isLocationLine(cellValue) && !isExactLocationLabel(cellValue)) return `Location: ${next}`;
  if (neighborIsLocationLabel) return next;
  return null;
}

const BUILDER_EDITOR = /^\/form-builder\/\d+$/;

/** Pages that can be a filed folder item. The explorer draws its own path. */
export function folderPathLookupEnabled(pathname: string): boolean {
  const path = pathname.split("?")[0] ?? pathname;
  if (!path || path === "/documents/folders") return false;
  if (path.startsWith("/blank-forms/start/")) return true;
  if (BUILDER_EDITOR.test(path)) return true;
  return recordSurface(path) != null;
}

/**
 * The folder row for the page that is open.
 * A form built in the app is filed at /form-builder/template/:id even while its editor is /form-builder/:id.
 */
export function folderNodeForRoute<T extends BrowseFolder>(folders: T[], pathname: string): T | null {
  const path = pathname.split("?")[0] ?? pathname;
  if (!folderPathLookupEnabled(path)) return null;
  const editor = /^\/form-builder\/(\d+)$/.exec(path);
  const document = /^\/documents\/(\d+)$/.exec(path);
  const matches = folders.filter((folder) => {
    const linked = folder.linkedPath?.split("?")[0] ?? "";
    if (linked && linked === path) return true;
    if (editor && linked === `/form-builder/template/${editor[1]}`) return true;
    if (document && folder.documentId === Number(document[1])) return true;
    return false;
  });
  if (matches.length === 0) return null;
  return [...matches].sort((a, b) => (a.parentId == null ? 1 : 0) - (b.parentId == null ? 1 : 0) || a.id - b.id)[0] ?? null;
}
