/**
 * Named folders the click-through asked to take out of the library.
 * Real files move to the folder that stays. Empty containers are removed.
 * A missing destination leaves the source in place so a controlled record is not dropped.
 */
import { eq, inArray } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
const FAI_VALIDATION_FOLDER_NAME = "FAI / Validation";

export const ENGINEERING_PRODUCTS = ["CSA", "Fuel", "Shocks", "Air Suspension", "Gas/Electric Lifts"] as const;

export interface FolderIdentity {
  id: number;
  name: string;
  parentId: number | null;
}

export interface FolderMove {
  sourceId: number;
  destId: number;
}

function byIdMap(folders: FolderIdentity[]): Map<number, FolderIdentity> {
  return new Map(folders.map((folder) => [folder.id, folder]));
}

export function ancestorNames(folders: FolderIdentity[], id: number): string[] {
  const byId = byIdMap(folders);
  const names: string[] = [];
  let current = byId.get(id);
  const seen = new Set<number>();
  while (current?.parentId != null && !seen.has(current.parentId)) {
    seen.add(current.parentId);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    names.unshift(parent.name);
    current = parent;
  }
  return names;
}

function childrenOf(folders: FolderIdentity[], parentId: number): FolderIdentity[] {
  return folders.filter((folder) => folder.parentId === parentId);
}

function childNamed(folders: FolderIdentity[], parentId: number, name: string): FolderIdentity | undefined {
  return folders.find((folder) => folder.parentId === parentId && folder.name === name);
}

function departmentNamed(folders: FolderIdentity[], name: string): FolderIdentity | undefined {
  const iso = folders.find((folder) => folder.parentId == null && folder.name === "ISO Compliance Documents");
  if (iso) {
    const under = childNamed(folders, iso.id, name);
    if (under) return under;
  }
  return folders.find((folder) => folder.parentId == null && folder.name === name);
}

function faiProduct(folders: FolderIdentity[], product: string): FolderIdentity | undefined {
  const quality = departmentNamed(folders, "Quality");
  if (!quality) return undefined;
  const fai = childNamed(folders, quality.id, FAI_VALIDATION_FOLDER_NAME);
  if (!fai) return undefined;
  return childNamed(folders, fai.id, product);
}

function underName(folders: FolderIdentity[], id: number, name: string): boolean {
  return ancestorNames(folders, id).includes(name) || folders.find((folder) => folder.id === id)?.name === name;
}

/** True when creating this name under these ancestors would put a retired folder back. */
export function isRetiredFolderPlacement(name: string, ancestorNamesList: string[]): boolean {
  const parent = ancestorNamesList[ancestorNamesList.length - 1];
  if (name === "Components & Parts" && ancestorNamesList.includes("Material Management")) return true;
  if (name === "MRB Engineering Decisions") return true;
  if (name === "Calibration Procedures" && parent === "Calibration & Equipment") return true;
  if (name === "Customer Complaint Records" || name === "Customer Complaint") return true;
  if (parent === "Engineering" && (ENGINEERING_PRODUCTS as readonly string[]).includes(name)) return true;
  if (name === "Fuel" && ancestorNamesList.includes("CSA") && ancestorNamesList.includes("Engineering") && !ancestorNamesList.includes(FAI_VALIDATION_FOLDER_NAME)) return true;
  if (
    (name === "Validation" || name === "Development") &&
    ancestorNamesList.includes("Engineering") &&
    !ancestorNamesList.includes(FAI_VALIDATION_FOLDER_NAME) &&
    (ENGINEERING_PRODUCTS as readonly string[]).some((product) => ancestorNamesList.includes(product))
  ) {
    return true;
  }
  return false;
}

function keptCalibrationFolder(folders: FolderIdentity[]): FolderIdentity | undefined {
  const quality = departmentNamed(folders, "Quality");
  const procedures = quality ? childNamed(folders, quality.id, "Procedures (SOPs)") : undefined;
  const policy = procedures ? childNamed(folders, procedures.id, "Calibration Procedure") : undefined;
  if (policy) return policy;
  const engineering = departmentNamed(folders, "Engineering");
  const measurement = engineering ? childNamed(folders, engineering.id, "Calibration & Measurement") : undefined;
  return measurement ? childNamed(folders, measurement.id, "Calibration Procedures") : undefined;
}

/**
 * Moves, deepest special cases first. A source is skipped when its destination
 * folder is not already in the library.
 */
export function planRetiredFolderMoves(folders: FolderIdentity[]): FolderMove[] {
  const moves: FolderMove[] = [];
  const claimed = new Set<number>();

  function add(source: FolderIdentity | undefined, dest: FolderIdentity | undefined) {
    if (!source || !dest || source.id === dest.id || claimed.has(source.id)) return;
    if (underName(folders, source.id, FAI_VALIDATION_FOLDER_NAME) && source.name !== "Calibration Procedures" && source.name !== "Customer Complaint Records" && source.name !== "Customer Complaint") {
      return;
    }
    claimed.add(source.id);
    moves.push({ sourceId: source.id, destId: dest.id });
  }

  const fuelDest = faiProduct(folders, "Fuel");
  for (const folder of folders) {
    if (folder.name !== "Fuel") continue;
    const ancestors = ancestorNames(folders, folder.id);
    if (ancestors.includes(FAI_VALIDATION_FOLDER_NAME)) continue;
    const underCsa = ancestors.includes("CSA") && ancestors.includes("Engineering");
    const engineeringProduct = ancestors[ancestors.length - 1] === "Engineering";
    const hasValDev = childrenOf(folders, folder.id).some((child) => child.name === "Validation" || child.name === "Development");
    if (underCsa || engineeringProduct || hasValDev) add(folder, fuelDest);
  }

  const engineering = departmentNamed(folders, "Engineering");
  if (engineering) {
    for (const product of ENGINEERING_PRODUCTS) {
      if (product === "Fuel") continue;
      add(childNamed(folders, engineering.id, product), faiProduct(folders, product));
    }
  }

  const material = departmentNamed(folders, "Material Management");
  if (material) add(childNamed(folders, material.id, "Components & Parts"), material);

  for (const folder of folders) {
    if (folder.name !== "MRB Engineering Decisions" || folder.parentId == null) continue;
    add(folder, folders.find((row) => row.id === folder.parentId));
  }

  const calibrationKeep = keptCalibrationFolder(folders);
  for (const folder of folders) {
    if (folder.name !== "Calibration Procedures" || folder.parentId == null) continue;
    const parent = folders.find((row) => row.id === folder.parentId);
    if (parent?.name === "Calibration & Equipment") add(folder, calibrationKeep);
  }

  for (const folder of folders) {
    if (folder.name !== "Customer Complaint Records" && folder.name !== "Customer Complaint") continue;
    if (folder.parentId == null) continue;
    add(folder, folders.find((row) => row.id === folder.parentId));
  }

  return moves;
}

type FolderRow = typeof documentFolders.$inferSelect;

function hasPayload(folder: FolderRow): boolean {
  return folder.pdfPath != null || folder.documentId != null || folder.linkedPath != null;
}

function subtreeIds(list: FolderIdentity[], rootId: number): number[] {
  const ids = [rootId];
  const pending = [rootId];
  while (pending.length > 0) {
    const id = pending.pop()!;
    for (const child of list.filter((folder) => folder.parentId === id)) {
      ids.push(child.id);
      pending.push(child.id);
    }
  }
  return ids;
}

/** Moves files and filings onto `destId`, then deletes empty containers in the source tree. */
export async function flattenFolderInto(db: Db, list: FolderRow[], sourceId: number, destId: number): Promise<FolderRow[]> {
  if (sourceId === destId) return list;
  const ids = subtreeIds(list, sourceId).filter((id) => id !== destId);
  if (ids.length === 0) return list;

  await db.update(formFilings).set({ folderNodeId: destId, updatedAt: new Date() }).where(inArray(formFilings.folderNodeId, ids));
  await db.update(controlledFormTemplates).set({ folderId: destId }).where(inArray(controlledFormTemplates.folderId, ids));

  for (const id of ids) {
    const row = list.find((folder) => folder.id === id);
    if (!row || !hasPayload(row) || row.parentId === destId) continue;
    await db.update(documentFolders).set({ parentId: destId, updatedAt: new Date() }).where(eq(documentFolders.id, id));
    list = list.map((folder) => (folder.id === id ? { ...folder, parentId: destId } : folder));
  }

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const id of ids) {
      const row = list.find((folder) => folder.id === id);
      if (!row || hasPayload(row) || list.some((folder) => folder.parentId === id)) continue;
      await db.delete(documentFolders).where(eq(documentFolders.id, id));
      list = list.filter((folder) => folder.id !== id);
      progressed = true;
    }
  }
  return list;
}

export async function retireNamedDocumentFolders(db: Db, list: FolderRow[]): Promise<FolderRow[]> {
  let current = list;
  for (const move of planRetiredFolderMoves(current)) {
    if (!current.some((folder) => folder.id === move.sourceId) || !current.some((folder) => folder.id === move.destId)) continue;
    current = await flattenFolderInto(db, current, move.sourceId, move.destId);
  }
  return current;
}
