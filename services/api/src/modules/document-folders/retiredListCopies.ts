/**
 * Old Quality Manual uploads of LST-EQP-001, LST-GEN-001, and LST-GEN-003.
 * The in-app list is the controlled copy. An uploaded workbook, and the empty
 * folder left behind when that upload was detached, are removed from the folder.
 * The file bytes stay on disk; the audit row records where they were.
 */
import { eq } from "drizzle-orm";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import type { Db } from "../../lib/requestDb.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { rememberDeletedDocumentFolder } from "./folderTombstones.js";

const ISO_ROOT = "ISO Compliance Documents";
const QUALITY_MANUAL = "Quality Manual";

const RETIRED_QUALITY_MANUAL_LISTS = [
  { docId: "LST-EQP-001", title: "Master Equipment List", route: "/calibration/master-list" },
  { docId: "LST-GEN-001", title: "Master Document List", route: "/documents/master-list" },
  { docId: "LST-GEN-003", title: "Scope of Laboratory Activities", route: "/documents/laboratory-scope" },
] as const;

export interface QualityManualNode {
  id: number;
  name: string;
  parentId: number | null;
  pdfPath?: string | null;
  linkedPath?: string | null;
  documentId?: number | null;
}

export type QualityManualCleanup =
  | { id: number; action: "delete-node"; name: string; parentId: number | null; archivedPath: string | null }
  | { id: number; action: "archive-attachment"; name: string; archivedPath: string };

function listRoute(linkedPath: string | null | undefined): string {
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

export function retiredQualityManualList(node: Pick<QualityManualNode, "name" | "linkedPath">): (typeof RETIRED_QUALITY_MANUAL_LISTS)[number] | null {
  const route = listRoute(node.linkedPath);
  const byRoute = RETIRED_QUALITY_MANUAL_LISTS.find((list) => list.route === route);
  if (byRoute) return byRoute;
  const name = bareName(node.name);
  if (!name) return null;
  for (const list of RETIRED_QUALITY_MANUAL_LISTS) {
    const id = list.docId.toLowerCase();
    const title = list.title.toLowerCase();
    if (name === id || name === title) return list;
    if (name.startsWith(`${id} `) || name.startsWith(`${id}-`)) return list;
  }
  return null;
}

function qualityManualId(folders: QualityManualNode[]): number | null {
  const iso = folders.find((folder) => folder.parentId == null && folder.name === ISO_ROOT);
  if (!iso) return null;
  return folders.find((folder) => folder.parentId === iso.id && folder.name === QUALITY_MANUAL)?.id ?? null;
}

function underQualityManual(folders: QualityManualNode[], manualId: number, id: number): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(id);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.id === manualId) return true;
    if (current.parentId == null) return false;
    current = byId.get(current.parentId);
  }
  return false;
}

/**
 * Rows to drop or detach under Quality Manual.
 * A living in-app link stays. An extra upload of the same list is removed once that link exists.
 * An empty leftover named like the uploaded file is removed even when it is the only row.
 * An empty row named exactly like the in-app list is left alone until that link exists, so filing can attach it.
 */
export function planQualityManualCopyCleanup(folders: QualityManualNode[]): QualityManualCleanup[] {
  const manualId = qualityManualId(folders);
  if (manualId == null) return [];
  const childIds = new Set(folders.map((folder) => folder.parentId).filter((id): id is number => id != null));
  const inManual = (folder: QualityManualNode) => folder.id !== manualId && underQualityManual(folders, manualId, folder.id);
  const livingByRoute = new Map<string, QualityManualNode[]>();
  for (const folder of folders) {
    if (!inManual(folder)) continue;
    const list = retiredQualityManualList(folder);
    if (!list || listRoute(folder.linkedPath) !== list.route) continue;
    const group = livingByRoute.get(list.route) ?? [];
    group.push(folder);
    livingByRoute.set(list.route, group);
  }
  const keepLiving = new Set<number>();
  const plan: QualityManualCleanup[] = [];
  for (const group of livingByRoute.values()) {
    const ranked = [...group].sort((a, b) => Number(Boolean(a.pdfPath)) - Number(Boolean(b.pdfPath)) || a.id - b.id);
    const keeper = ranked[0];
    if (!keeper) continue;
    keepLiving.add(keeper.id);
    if (keeper.pdfPath) plan.push({ id: keeper.id, action: "archive-attachment", name: keeper.name, archivedPath: keeper.pdfPath });
    for (const extra of ranked.slice(1)) {
      if (childIds.has(extra.id)) {
        if (extra.pdfPath) plan.push({ id: extra.id, action: "archive-attachment", name: extra.name, archivedPath: extra.pdfPath });
        continue;
      }
      plan.push({ id: extra.id, action: "delete-node", name: extra.name, parentId: extra.parentId, archivedPath: extra.pdfPath ?? null });
    }
  }
  for (const folder of folders) {
    if (!inManual(folder) || keepLiving.has(folder.id)) continue;
    const list = retiredQualityManualList(folder);
    if (!list || listRoute(folder.linkedPath) === list.route) continue;
    if (childIds.has(folder.id)) continue;
    const emptyShell = !folder.pdfPath && folder.documentId == null;
    const oldCopy = Boolean(folder.pdfPath) || folder.documentId != null;
    if (!emptyShell && !oldCopy) continue;
    if (oldCopy && !emptyShell && !livingByRoute.has(list.route)) continue;
    // An unlinked row named exactly like the in-app list is the shell filing attaches. Leave it.
    // A leftover upload name (document number plus a title, or a workbook name) is not that shell.
    const bare = bareName(folder.name);
    const canonical = bare === list.docId.toLowerCase() || bare === list.title.toLowerCase();
    if (emptyShell && canonical && !livingByRoute.has(list.route)) continue;
    plan.push({
      id: folder.id,
      action: "delete-node",
      name: folder.name,
      parentId: folder.parentId,
      archivedPath: folder.pdfPath ?? null,
    });
  }
  return plan;
}

/** Applies the plan. Safe to run again: a second pass finds nothing left to change. File bytes are not deleted. */
export async function retireQualityManualCopies<T extends QualityManualNode>(db: Db, folders: T[], performedBy?: number): Promise<T[]> {
  const plan = planQualityManualCopyCleanup(folders);
  if (plan.length === 0) return folders;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = folders;
  for (const step of plan) {
    const folder = byId.get(step.id);
    if (!folder) continue;
    if (step.action === "archive-attachment") {
      await db.update(documentFolders).set({ pdfPath: null, pdfMimeType: null, updatedAt: new Date() }).where(eq(documentFolders.id, step.id));
      current = current.map((row) => (row.id === step.id ? { ...row, pdfPath: null } : row));
      await recordAuditTrail(db, {
        entityType: "DocumentFolder",
        entityId: step.id,
        action: "update",
        performedBy,
        changes: {
          action: "archive_uploaded_list",
          summary: `Archived the uploaded file on "${step.name}". The in-app list stays in the folder. The file was not deleted.`,
          archivedPath: step.archivedPath,
          name: step.name,
        },
      });
      continue;
    }
    await db.delete(documentFolders).where(eq(documentFolders.id, step.id));
    const parent = folder.parentId == null ? null : byId.get(folder.parentId);
    const nameStillUsed = current.some((row) => row.id !== step.id && row.parentId === folder.parentId && row.name === folder.name);
    if (!nameStillUsed) await rememberDeletedDocumentFolder(db, parent?.name ?? null, folder.name);
    current = current.filter((row) => row.id !== step.id);
    await recordAuditTrail(db, {
      entityType: "DocumentFolder",
      entityId: step.id,
      action: "delete",
      performedBy,
      changes: {
        action: "retire_uploaded_list_copy",
        summary: folder.pdfPath
          ? `Removed the old uploaded copy "${step.name}" from Quality Manual. The in-app list is the controlled copy. The file was archived and kept.`
          : `Removed the empty folder "${step.name}" from Quality Manual. It had no items. Nothing was left in its place.`,
        archivedPath: step.archivedPath,
        name: step.name,
        parentId: step.parentId,
      },
    });
  }
  return current;
}
