/**
 * Windows Explorer details rows for one folder.
 * Subfolders stay first. Controlled lists use the document number and title,
 * with the revision kept in its own column. A list is shown once per folder.
 */
import { isBlankTemplateLink, isFiledRecordPath, isLivingListPath, listFolder, openTarget, type BrowseFolder } from "./folderBrowse";

export interface ControlledListRecord {
  docId: string;
  title: string;
  route: string;
  /** Catalog revision. A listRevision on the folder row (the stored list) wins. */
  revision: string;
}

/** In-app controlled lists. Titles are the document titles, not the folder's display name. */
export const CONTROLLED_LISTS: readonly ControlledListRecord[] = [
  { docId: "LST-EQP-001", title: "Master Equipment List", route: "/calibration/master-list", revision: "A" },
  { docId: "LST-GEN-001", title: "Master Document List", route: "/documents/master-list", revision: "B" },
  { docId: "LST-GEN-002", title: "Internal Audit Schedule", route: "/documents/internal-audit-schedule", revision: "A" },
  { docId: "LST-GEN-003", title: "Scope of Laboratory Activities", route: "/documents/laboratory-scope", revision: "A" },
  { docId: "LST-DEV-001", title: "Development Log (Register)", route: "/documents/development-log", revision: "B" },
  { docId: "LST-NCR-001", title: "Non-Conformance Log (Register)", route: "/documents/nonconformance-log", revision: "G" },
  { docId: "LST-ENG-001", title: "Engineering Request Change Log", route: "/documents/engineering-request-log", revision: "A" },
];

export type FolderItemType = "folder" | "controlled list" | "form" | "file" | "template";

export type FolderDetailSortKey = "name" | "type" | "revision" | "modified" | "modifiedBy";

export interface FolderDetailSort {
  key: FolderDetailSortKey;
  direction: "asc" | "desc";
}

export interface FolderDetailNode extends BrowseFolder {
  updatedAt?: string | Date | null;
  createdAt?: string | Date | null;
  documentTitle?: string | null;
  documentRevisionCode?: string | null;
  documentUpdatedAt?: string | Date | null;
  /** Revision stored on the controlled list row. */
  listRevision?: string | null;
  listUpdatedAt?: string | Date | null;
  modifiedByName?: string | null;
  documentStatus?: string | null;
  documentExpirationStatus?: string | null;
}

export interface FolderDetailItem<T extends FolderDetailNode = FolderDetailNode> {
  node: T;
  type: FolderItemType;
  label: string;
  revision: string | null;
  modifiedAt: string | null;
  modifiedBy: string | null;
  href: string | null;
}

export interface SavedItemRemoval {
  /** remove-item takes the row out of the folder. unlink-file leaves the item and drops only the upload. */
  mode: "remove-item" | "unlink-file";
  title: string;
  body: string;
  confirm: string;
}

const DEFAULT_SORT: FolderDetailSort = { key: "name", direction: "asc" };

function listPath(linkedPath: string | null | undefined): string {
  if (!linkedPath) return "";
  return linkedPath.split("?")[0] ?? linkedPath;
}

function bareName(name: string): string {
  return name
    .replace(/\.(xlsx|xls|xlsm|pdf|docx)$/i, "")
    .replace(/\s+-\s+rev\b.*$/i, "")
    .trim()
    .toLowerCase();
}

/** The controlled list this row is, whether the folder stored a title, a document number, or both. */
export function controlledListFor(node: Pick<FolderDetailNode, "name" | "linkedPath">): ControlledListRecord | null {
  const route = listPath(node.linkedPath);
  const byRoute = CONTROLLED_LISTS.find((list) => list.route === route);
  if (byRoute) return byRoute;
  const name = bareName(node.name);
  if (!name) return null;
  for (const list of CONTROLLED_LISTS) {
    const id = list.docId.toLowerCase();
    const title = list.title.toLowerCase();
    if (name === id || name === title) return list;
    if (name.startsWith(`${id} `) || name.startsWith(`${id}-`)) return list;
  }
  return null;
}

export function folderItemLabel(node: Pick<FolderDetailNode, "name" | "linkedPath" | "documentTitle">): string {
  const list = controlledListFor(node);
  if (list) return `${list.docId} - ${list.title}`;
  const title = node.documentTitle?.trim();
  if (title && node.name.trim().toLowerCase() !== title.toLowerCase() && !node.name.toLowerCase().includes(title.toLowerCase())) {
    return `${node.name.trim()} - ${title}`;
  }
  return node.name;
}

export function folderItemType(node: FolderDetailNode, isFolder: boolean): FolderItemType {
  if (isFolder) return "folder";
  if (controlledListFor(node)) return "controlled list";
  if (isBlankTemplateLink(node.linkedPath)) return "template";
  if (isFiledRecordPath(node.linkedPath)) return "form";
  return "file";
}

function revisionText(value: string | null | undefined): string | null {
  const raw = value?.trim() ?? "";
  if (!raw) return null;
  const stripped = raw.replace(/^rev[:\s.-]*/i, "").trim();
  return stripped || null;
}

export function folderItemRevision(node: FolderDetailNode): string | null {
  const list = controlledListFor(node);
  if (node.listRevision?.trim()) return revisionText(node.listRevision);
  if (list) return revisionText(list.revision);
  return revisionText(node.documentRevisionCode);
}

function stamp(value: string | Date | null | undefined): string | null {
  if (value == null || value === "") return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

export function folderItemModifiedAt(node: FolderDetailNode): string | null {
  return stamp(node.listUpdatedAt) ?? stamp(node.documentUpdatedAt) ?? stamp(node.updatedAt) ?? stamp(node.createdAt);
}

function describe<T extends FolderDetailNode>(node: T, isFolder: boolean): FolderDetailItem<T> {
  const list = controlledListFor(node);
  const href = isFolder ? null : (openTarget(node) ?? (list ? list.route : null));
  return {
    node,
    type: folderItemType(node, isFolder),
    label: isFolder ? node.name : folderItemLabel(node),
    revision: isFolder ? null : folderItemRevision(node),
    modifiedAt: folderItemModifiedAt(node),
    modifiedBy: node.modifiedByName?.trim() || null,
    href,
  };
}

/** Prefer the in-app list. An old upload or an empty shell of the same document number is dropped. */
function dedupeLists<T extends FolderDetailNode>(items: FolderDetailItem<T>[]): FolderDetailItem<T>[] {
  const rank = (item: FolderDetailItem<T>) => {
    const living = isLivingListPath(item.node.linkedPath);
    if (living && !item.node.pdfPath) return 0;
    if (living) return 1;
    if (!item.node.pdfPath && item.node.documentId == null) return 2;
    return 3;
  };
  const winner = new Map<string, FolderDetailItem<T>>();
  for (const item of items) {
    const list = controlledListFor(item.node);
    if (!list || item.type === "folder") continue;
    const current = winner.get(list.docId);
    if (!current || rank(item) < rank(current) || (rank(item) === rank(current) && item.node.id < current.node.id)) winner.set(list.docId, item);
  }
  const seen = new Set<string>();
  const result: FolderDetailItem<T>[] = [];
  for (const item of items) {
    const list = item.type === "folder" ? null : controlledListFor(item.node);
    if (!list) {
      result.push(item);
      continue;
    }
    if (seen.has(list.docId)) continue;
    seen.add(list.docId);
    const kept = winner.get(list.docId);
    if (kept) result.push(kept);
  }
  return result;
}

function sortValue(item: FolderDetailItem, key: FolderDetailSortKey): string {
  if (key === "name") return item.label;
  if (key === "type") return item.type;
  if (key === "revision") return item.revision ?? "";
  if (key === "modified") return item.modifiedAt ?? "";
  return item.modifiedBy ?? "";
}

export function sortFolderDetails<T extends FolderDetailNode>(items: FolderDetailItem<T>[], sort: FolderDetailSort = DEFAULT_SORT): FolderDetailItem<T>[] {
  const direction = sort.direction === "desc" ? -1 : 1;
  const compare = (a: FolderDetailItem<T>, b: FolderDetailItem<T>) => {
    const primary = sortValue(a, sort.key).localeCompare(sortValue(b, sort.key), undefined, { numeric: true, sensitivity: "base" });
    if (primary !== 0) return primary * direction;
    return a.label.localeCompare(b.label, undefined, { numeric: true, sensitivity: "base" });
  };
  const folders = items.filter((item) => item.type === "folder").sort(compare);
  const rest = items.filter((item) => item.type !== "folder").sort(compare);
  return [...folders, ...rest];
}

/**
 * Immediate children of one folder: subfolders first, then saved items.
 * An empty controlled-list shell is an item, not a folder. Each list is kept once.
 */
export function folderContents<T extends FolderDetailNode>(folders: T[], parentId: number | null, sort: FolderDetailSort = DEFAULT_SORT): FolderDetailItem<T>[] {
  const listing = listFolder(folders, parentId);
  const folderItems: FolderDetailItem<T>[] = [];
  const fileItems: FolderDetailItem<T>[] = listing.files.map((node) => describe(node, false));
  for (const node of listing.folders) {
    const hasChildren = folders.some((folder) => folder.parentId === node.id);
    if (!hasChildren && controlledListFor(node)) fileItems.push(describe(node, false));
    else folderItems.push(describe(node, true));
  }
  return sortFolderDetails([...folderItems, ...dedupeLists(fileItems)], sort);
}

/**
 * What Remove does to a saved upload.
 * A file-only row is taken out of the folder. A list or form that also has a file keeps the item and unlinks the file.
 * Neither path leaves the row behind as an empty folder.
 */
export function savedItemRemoval(node: Pick<FolderDetailNode, "name" | "linkedPath" | "documentId" | "pdfPath">, hasChildren: boolean): SavedItemRemoval {
  const name = node.name.trim() || "this item";
  const keepsItem = hasChildren || Boolean(node.linkedPath) || node.documentId != null;
  if (keepsItem) {
    return {
      mode: "unlink-file",
      title: "Unlink uploaded file",
      confirm: "Unlink file",
      body: `Unlink the uploaded file from "${name}"? The file is archived and kept. The item stays in this folder and still opens as it does today. This does not delete the item and does not create a folder.`,
    };
  }
  return {
    mode: "remove-item",
    title: "Remove from folder",
    confirm: "Remove from folder",
    body: `Remove "${name}" from this folder? The uploaded file is archived and kept. The item is taken out of the folder. This does not delete a controlled record, and it does not leave an empty folder behind.`,
  };
}
