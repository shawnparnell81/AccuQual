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

/**
 * Quality's former FAI drawer, renamed in place. The string matches
 * FAI_VALIDATION_FOLDER_NAME in services/api companyDocumentFolders.ts.
 */
export const FAI_VALIDATION_FOLDER_NAME = "FAI / Validation";

/** Sidebar and bookmark URL for the old Validation Reports folder page. */
export const LEGACY_VALIDATION_REPORTS_PATH = "/folders/validation-reports";

/** Folder Explorer opened on FAI / Validation, without needing its numeric id. */
export function faiValidationDocumentsHref(): string {
  return `/documents/folders?name=${encodeURIComponent(FAI_VALIDATION_FOLDER_NAME)}`;
}

/** Crumb on a validation record. The list lives in the Documents folder, not a sidebar tab. */
export function validationReportsCrumb(): { label: string; to: string } {
  return { label: FAI_VALIDATION_FOLDER_NAME, to: faiValidationDocumentsHref() };
}

/**
 * Folder id for a Documents deep link by name.
 * When the same name exists twice, the copy under Quality wins.
 */
export function folderIdByName<T extends BrowseFolder>(folders: T[], name: string): number | null {
  const matches = folders.filter((folder) => folder.name === name);
  if (matches.length === 0) return null;
  const underQuality = matches.find((folder) => folders.some((parent) => parent.id === folder.parentId && parent.name === "Quality"));
  return (underQuality ?? matches[0])!.id;
}

/** The only content root in Documents. Departments are children of this folder. */
export const ISO_DOCUMENTS_FOLDER = "ISO Compliance Documents";

const LIBRARY_POOL_NAME = "Library Pool";

/** ISO Compliance Documents when it is a real root. */
export function contentRoot<T extends BrowseFolder>(folders: T[]): T | undefined {
  return folders.find((folder) => folder.parentId == null && folder.name === ISO_DOCUMENTS_FOLDER);
}

/**
 * Left-hand department list. Children of ISO stay on the list.
 * Library Pool is the remove-shelf, not a department.
 * A department that is still a true root (before the layout migration) stays on the list too.
 */
export function leftHandFolders<T extends BrowseFolder>(folders: T[]): T[] {
  const iso = contentRoot(folders);
  const nested = iso ? folders.filter((folder) => folder.parentId === iso.id && folder.name !== BLANK_FORM_TEMPLATES_FOLDER) : [];
  const stray = folders.filter((folder) => folder.parentId == null && folder.id !== iso?.id && folder.name !== LIBRARY_POOL_NAME);
  return [...nested, ...stray].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
}

/** Department to highlight when a folder deep link opens. ISO's child wins over the ISO root itself. */
export function departmentForFolder<T extends BrowseFolder>(folders: T[], folderId: number): T | undefined {
  const iso = contentRoot(folders);
  const chain = folderChain(folders, folderId);
  if (iso) {
    const underIso = chain.find((folder) => folder.parentId === iso.id);
    if (underIso) return underIso;
    if (chain[0]?.id === iso.id) return iso;
  }
  return chain[0];
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

/** Older blank drawer. Folder Explorer still hides it. Living lists stay here until they are removed. */
export const BLANK_FORM_TEMPLATES_FOLDER = "Blank Form Templates";

/** Fillable blanks live here, under ISO Compliance Documents. */
export const BLANK_FORMS_TEMPLATES_FOLDER = "Blank Forms Templates";

/** Explorer shortcut that starts a fresh copy of one blank. */
export const BLANK_TEMPLATE_START_PREFIX = "/blank-forms/start/";

export function isBlankTemplateLink(linkedPath: string | null | undefined): boolean {
  return typeof linkedPath === "string" && linkedPath.startsWith(BLANK_TEMPLATE_START_PREFIX);
}

/** Folder Explorer opened on Blank Forms Templates. */
export function blankFormsFolderHref(): string {
  return `/documents/folders?name=${encodeURIComponent(BLANK_FORMS_TEMPLATES_FOLDER)}`;
}

/**
 * Original layout drawer whose children are empty form names (NCR Form, 8D Form, and the rest).
 * Folder Explorer does not list those empty shells. Fillable blanks live in Blank Forms Templates.
 */
export const SEEDED_FORMS_DRAWER = "Forms & Templates";

/** Living controlled lists. Opening one edits the grid in the app. */
const LIVING_LIST_PATHS = new Set(["/documents/master-list", "/calibration/master-list", "/documents/laboratory-scope", "/documents/development-log"]);

export function isLivingListPath(linkedPath: string | null | undefined): boolean {
  if (!linkedPath) return false;
  const path = linkedPath.split("?")[0] ?? linkedPath;
  return LIVING_LIST_PATHS.has(path);
}

/** A module home or blank route, such as `/ncr` or `/qms-forms/document_revision_record`. A saved copy has a record id, or is the single Pareto chart. */
export function isFiledRecordPath(linkedPath: string | null | undefined): boolean {
  if (!linkedPath) return false;
  if (linkedPath === "/pareto") return true;
  return /\/\d+(?:\/|$)/.test(linkedPath);
}

/** Uploaded file, controlled document, a saved form, a blank-template shortcut, or a living list. A shortcut to a blank module is not saved work. */
export function isSavedDocument<T extends BrowseFolder>(node: T): boolean {
  return Boolean(node.pdfPath || node.documentId != null || isFiledRecordPath(node.linkedPath) || isBlankTemplateLink(node.linkedPath) || isLivingListPath(node.linkedPath));
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

/** This folder and everything nested under a blank-template library. Filled copies are not saved here. */
export function templateLibraryIds<T extends BrowseFolder>(folders: T[]): Set<number> {
  const hidden = new Set<number>();
  const stack = folders
    .filter((folder) => folder.name === BLANK_FORM_TEMPLATES_FOLDER || folder.name === BLANK_FORMS_TEMPLATES_FOLDER)
    .map((folder) => folder.id);
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
  const library = templateLibraryIds(folders);
  return folders.filter((folder) => !hidden.has(folder.id) && !library.has(folder.id) && isFolderEntry(folders, folder));
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

/** Where a click on a saved row goes. A blank template opens a fresh copy. A blank-module shortcut is not an openable file. */
export function openTarget(node: BrowseFolder): string | null {
  if (node.linkedPath && (isFiledRecordPath(node.linkedPath) || isBlankTemplateLink(node.linkedPath) || isLivingListPath(node.linkedPath))) {
    return isBlankTemplateLink(node.linkedPath) ? node.linkedPath : (node.linkedPath.split("?")[0] ?? node.linkedPath);
  }
  if (node.documentId != null) return `/documents/${node.documentId}`;
  return null;
}

/** The folder a filled copy was filed in. Null until it has a parent folder. */
export function filingLocation(parentId: number | null, parentPath: string[], fileName: string | null): FiledLocation | null {
  if (parentId == null || parentPath.length === 0) return null;
  return { path: parentPath.join(" / "), folderId: parentId, fileName };
}
