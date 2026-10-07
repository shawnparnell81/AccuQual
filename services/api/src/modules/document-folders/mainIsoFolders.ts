/**
 * Shawn's main filing drawers, direct children of ISO Compliance Documents.
 * Number prefixes from the Windows folder list are dropped. The order is the
 * order he files in: Master Source Files first, Obsolete Archive last.
 *
 * They are created once. company.profile.isoMainFoldersReady remembers that
 * this company has already been set up, so a later load does not put a
 * deleted folder back, does not add a second copy, and does not rewrite a
 * rename or a reorder. A company that already has one of these drawers from
 * the first release is marked ready without creating whatever is missing.
 *
 * A name is reused only on that first run, and only when it is already a
 * direct child of ISO. A folder with the same name deeper in the tree
 * (Engineering Standards under Specifications, Quality Manual under Quality)
 * is a different folder and stays where it is. Nothing here renames, moves,
 * or deletes an existing row. Sort order is written only on the run that
 * creates the drawers.
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company } from "../../drizzle/schema/company.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";

export const ISO_ROOT_NAME = "ISO Compliance Documents";

export const MAIN_ISO_FOLDER_NAMES = [
  "Master Source Files",
  "Quality Manual",
  "Procedures",
  "Blank Forms Templates",
  "Engineering Standards",
  "Equipment Records",
  "Test Data Projects",
  "Quality Logs",
  "Personnel Files",
  "Management System",
  "Supplier Evaluation",
  "Facility Records",
  "Engineering Logs",
  "Obsolete Archive",
] as const;

export interface NamedFolder {
  id: number;
  name: string;
  parentId: number | null;
}

export interface SortableFolder extends NamedFolder {
  sortOrder: number;
}

/** Names that still need a row directly under ISO. Empty when the set is already there. */
export function planMainIsoFolderCreates(folders: NamedFolder[]): { isoId: number; names: string[] } | null {
  const iso = folders.find((folder) => folder.parentId == null && folder.name === ISO_ROOT_NAME);
  if (!iso) return null;
  const direct = new Set(folders.filter((folder) => folder.parentId === iso.id).map((folder) => folder.name));
  return { isoId: iso.id, names: MAIN_ISO_FOLDER_NAMES.filter((name) => !direct.has(name)) };
}

/**
 * Names the first release added under ISO. "Procedures" is left out: the
 * default tree already has that drawer, so it cannot by itself mean the
 * company was set up.
 */
const SETUP_MARKER_NAMES = MAIN_ISO_FOLDER_NAMES.filter((name) => name !== "Procedures");

export type MainIsoSetupPlan = { action: "skip" } | { action: "adopt" } | { action: "seed"; isoId: number; names: string[] };

/**
 * skip: already recorded as set up, or there is no ISO root yet.
 * adopt: this company already has a main drawer, so missing ones were removed
 * or renamed and must not be recreated.
 * seed: first time. Create whatever is not already a direct child.
 */
export function planMainIsoSetup(folders: NamedFolder[], ready: boolean): MainIsoSetupPlan {
  if (ready) return { action: "skip" };
  const iso = folders.find((folder) => folder.parentId == null && folder.name === ISO_ROOT_NAME);
  if (!iso) return { action: "skip" };
  const direct = new Set(folders.filter((folder) => folder.parentId === iso.id).map((folder) => folder.name));
  if (SETUP_MARKER_NAMES.some((name) => direct.has(name))) return { action: "adopt" };
  const missing = planMainIsoFolderCreates(folders);
  return { action: "seed", isoId: iso.id, names: missing?.names ?? [] };
}

/** The 14 drawers first, in filing order, then every other child in its current order. */
export function mainIsoChildOrder<T extends SortableFolder>(children: T[]): T[] {
  const sorted = [...children].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const used = new Set<number>();
  const main: T[] = [];
  for (const name of MAIN_ISO_FOLDER_NAMES) {
    const row = sorted.find((child) => child.name === name && !used.has(child.id));
    if (!row) continue;
    used.add(row.id);
    main.push(row);
  }
  return [...main, ...sorted.filter((child) => !used.has(child.id))];
}

const FILED_RECORD = /\/\d+(?:\/|$)/;

/** A saved file or filled form is an item. A container, including one that only links to a blank module, is a folder. */
export function documentNodeKind(
  node: { id: number; pdfPath?: string | null; documentId?: number | null; linkedPath?: string | null },
  folders: { parentId: number | null }[],
): "folder" | "saved item" {
  if (folders.some((folder) => folder.parentId === node.id)) return "folder";
  const filed = node.linkedPath != null && FILED_RECORD.test(node.linkedPath);
  if (node.pdfPath || node.documentId != null || filed) return "saved item";
  return "folder";
}

/** Path of a folder, or "the top level" when it has no parent. Does not follow the row being moved. */
export function folderLocationLabel(folders: NamedFolder[], folderId: number | null): string {
  if (folderId == null) return "the top level";
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const names: string[] = [];
  let current = byId.get(folderId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name);
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return names.length > 0 ? names.join(" / ") : "the top level";
}

export function folderMoveAudit(input: {
  name: string;
  kind: "folder" | "saved item";
  fromParentId: number | null;
  toParentId: number | null;
  fromLabel: string;
  toLabel: string;
  renamedTo?: string;
}): Record<string, unknown> {
  const rename = input.renamedTo && input.renamedTo !== input.name ? ` and renamed it to "${input.renamedTo}"` : "";
  return {
    event: "moved",
    summary: `Moved the ${input.kind} "${input.name}" from ${input.fromLabel} → ${input.toLabel}${rename}.`,
    name: input.name,
    from: input.fromLabel,
    to: input.toLabel,
    fromParentId: input.fromParentId,
    toParentId: input.toParentId,
    ...(input.renamedTo && input.renamedTo !== input.name ? { renamedTo: input.renamedTo } : {}),
  };
}

export function folderRenameAudit(fromName: string, toName: string): Record<string, unknown> {
  return {
    event: "renamed",
    summary: `Renamed the folder from "${fromName}" to "${toName}".`,
    from: fromName,
    to: toName,
  };
}

type FolderRow = typeof documentFolders.$inferSelect;

async function isoMainFoldersReady(db: Db): Promise<boolean> {
  const [row] = await db.select({ profile: company.profile }).from(company).limit(1);
  return row?.profile?.isoMainFoldersReady === true;
}

/** Records that the one-time setup has happened. A profile save keeps the rest of the object. */
async function markIsoMainFoldersReady(db: Db): Promise<void> {
  const [row] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  if (!row || row.profile?.isoMainFoldersReady === true) return;
  await db.update(company).set({ profile: { ...(row.profile ?? {}), isoMainFoldersReady: true } }).where(eq(company.id, row.id));
}

/**
 * Creates the 14 drawers on the first run only. After that, and for a company
 * that already has them, a missing name stays missing.
 */
export async function ensureMainIsoFolders(db: Db, all: FolderRow[]): Promise<FolderRow[]> {
  const plan = planMainIsoSetup(all, await isoMainFoldersReady(db));
  if (plan.action === "skip") return all;
  if (plan.action === "adopt") {
    await markIsoMainFoldersReady(db);
    return all;
  }
  if (plan.names.length === 0) {
    await markIsoMainFoldersReady(db);
    return all;
  }

  let list = all;
  for (const name of plan.names) {
    if (list.some((folder) => folder.parentId === plan.isoId && folder.name === name)) continue;
    const [created] = await db.insert(documentFolders).values({ name, parentId: plan.isoId, sortOrder: 0 }).returning();
    if (!created) throw new Error(`Could not create the ${name} folder`);
    list = [...list, created];
  }

  const ordered = mainIsoChildOrder(list.filter((folder) => folder.parentId === plan.isoId));
  for (let sortOrder = 0; sortOrder < ordered.length; sortOrder += 1) {
    const row = ordered[sortOrder]!;
    if (row.sortOrder === sortOrder) continue;
    await db.update(documentFolders).set({ sortOrder, updatedAt: new Date() }).where(eq(documentFolders.id, row.id));
    list = list.map((folder) => (folder.id === row.id ? { ...folder, sortOrder } : folder));
  }
  await markIsoMainFoldersReady(db);
  return list;
}
