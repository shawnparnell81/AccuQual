/**
 * Shawn's Documents drawers, nested under ISO Compliance Documents.
 * Created the first time the folder list loads, and again later only where a
 * name is still missing. No schema change: an existing folder under the same
 * parent is left where an admin put it. A name that appears once here is
 * reused if someone moved it, unless that copy sits in the blank-template
 * library. A blank topic keeps that name, or gains " Forms" when the name
 * already belongs to a company folder. The blank stays on the shelf.
 * Moving an existing company onto this layout is the job of migration
 * 0094_iso_compliance_folder_tree.
 * Training is its own drawer under ISO, never a child of Quality. A company
 * that already has Quality/Training is repaired on this list load: saved
 * forms and files move into the ISO Training drawer, then the Quality child
 * is removed.
 * The Quality FAI drawer is renamed in place to "FAI / Validation" on this
 * same load. Children, filings, and files stay on that row. A second copy is
 * folded in. Engineering product trees that duplicate that drawer are moved
 * onto it and then removed (see retireNamedDocumentFolders).
 */
import { eq } from "drizzle-orm";
import type { Db } from "../../lib/requestDb.js";
import { company } from "../../drizzle/schema/company.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import { recordAuditTrail } from "../audit-trail/audit-trail.service.js";
import { type DefaultFolderSeed } from "./defaultDocumentFolders.js";
import {
  BLANK_FORMS_FOLDER,
  BLANK_TEMPLATE_START_PREFIX,
  FORM_TEMPLATES,
  PREVIOUS_BLANK_FORMS_FOLDER,
  keptOutOfBlankFormsTemplates,
} from "./formFiling.js";
import {
  CANONICAL_FOLDER_HOMES,
  namesOutsideBlankDrawers,
  planBlankShortcutReturns,
  folderIdentityKey,
  planBlankTopicRenames,
  planDuplicateFolderMerges,
  planLooseFolderMerges,
  type BlankTopicRename,
} from "./duplicateFolders.js";
import { ensureMainIsoFolders, folderLocationLabel, folderRenameAudit, itemFolderPath, MAIN_ISO_FOLDER_NAMES } from "./mainIsoFolders.js";
import { deletedDocumentFolderTokens, isTombstoned } from "./folderTombstones.js";
import { retireNamedDocumentFolders } from "./retiredFolderCleanup.js";

/** Blank shelves only. ISO itself is not a shelf: every real folder sits under it. */
const TEMPLATE_LIBRARY_NAMES = new Set(["Blank Form Templates", "Blank Forms Templates"]);

export const COMPANY_DOCUMENT_FOLDERS: DefaultFolderSeed[] = [
  {
    name: "ISO Compliance Documents",
    children: [
      {
        name: "Engineering",
        children: [],
      },
      {
        name: "Quality",
        children: [
          {
            name: "FAI / Validation",
            children: [
              { name: "CSA", children: [] },
              { name: "Shocks", children: [] },
              { name: "Fuel", children: [] },
              { name: "Brake Wear sensors", children: [] },
              { name: "Gas/Electric Lifts", children: [] },
              { name: "Air Suspension", children: [] },
            ],
          },
          { name: "Product Alerts", children: [] },
          { name: "Recalls", children: [] },
          { name: "Warranty", children: [] },
          { name: "Repair", children: [] },
          { name: "Inspections", children: [] },
        ],
      },
      {
        name: "Audits",
        children: [
          { name: "Internal Audit Schedule", children: [] },
          { name: "Internal Audit Reports", children: [] },
          { name: "External Audit Reports", children: [] },
          { name: "Audit Findings", children: [] },
          { name: "Audit Follow-Up", children: [] },
          { name: "Audit Evidence", children: [] },
          { name: "Safety Audits", children: [] },
        ],
      },
      {
        name: "Training",
        children: [
          { name: "Operator Training Records", children: [] },
          { name: "Machine Qualification", children: [] },
          { name: "Cross-Training Matrix", children: [] },
          { name: "Safety Training", children: [] },
          { name: "Production Certifications", children: [] },
        ],
      },
      {
        name: "Safety",
        children: [
          { name: "Safety Procedures", children: [] },
          { name: "PPE Requirements", children: [] },
          { name: "Incident Reports", children: [] },
          { name: "Lockout/Tagout Procedures", children: [] },
          { name: "Environmental Condition Records", children: [] },
        ],
      },
      { name: "Production", children: [] },
      { name: "CAPA", children: [] },
      { name: "NCR", children: [] },
      { name: "8D", children: [] },
      { name: "Work Instruction", children: [] },
      { name: "Procedures", children: [] },
      {
        name: "SOP",
        children: [{ name: "Policies", children: [] }],
      },
    ],
  },
];

/** Top-level filing drawers. They stay folders; the live NCR, CAPA, and 8D screens are unchanged. */
export const FILING_DRAWER_NAMES = new Set(["NCR", "CAPA", "8D", "Work Instruction", "Procedures", "SOP"]);

export interface FolderIdentity {
  id: number;
  name: string;
  parentId: number | null;
}

export function folderSeedPaths(nodes: DefaultFolderSeed[] = COMPANY_DOCUMENT_FOLDERS, prefix: string[] = []): string[][] {
  const paths: string[][] = [];
  for (const node of nodes) {
    const path = [...prefix, node.name];
    paths.push(path);
    paths.push(...folderSeedPaths(node.children, path));
  }
  return paths;
}

function uniqueSeedNames(nodes: DefaultFolderSeed[]): Set<string> {
  const counts = new Map<string, number>();
  function walk(list: DefaultFolderSeed[]) {
    for (const node of list) {
      counts.set(node.name, (counts.get(node.name) ?? 0) + 1);
      walk(node.children);
    }
  }
  walk(nodes);
  const unique = new Set<string>();
  for (const [name, count] of counts) {
    if (count === 1) unique.add(name);
  }
  return unique;
}

const UNIQUE_SEED_NAMES = uniqueSeedNames(COMPANY_DOCUMENT_FOLDERS);

export function inTemplateLibrary(folder: FolderIdentity, folders: FolderIdentity[]): boolean {
  const byId = new Map(folders.map((row) => [row.id, row]));
  let current: FolderIdentity | undefined = folder;
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (TEMPLATE_LIBRARY_NAMES.has(current.name)) return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

/**
 * The folder this seed name already occupies.
 * Repeated names (CSA, Validation, …) match only under the parent just resolved.
 * A one-off name is reused after a move, except a copy that lives with the blank templates.
 */
export function locateSeedFolder<T extends FolderIdentity>(folders: T[], name: string, parentId: number | null): T | undefined {
  const underParent = folders.find((folder) => folder.parentId === parentId && folder.name === name);
  if (underParent) return underParent;
  if (!UNIQUE_SEED_NAMES.has(name)) return undefined;
  return folders.find((folder) => folder.name === name && !inTemplateLibrary(folder, folders));
}

type FolderRow = typeof documentFolders.$inferSelect;

const ISO_FOLDER_NAME = "ISO Compliance Documents";
const TRAINING_FOLDER_NAME = "Training";
const QUALITY_FOLDER_NAME = "Quality";
const LEGACY_FAI_FOLDER_NAME = "FAI";

/** Quality drawer that holds the former FAI children. Engineering Validation folders keep their own names. */
export const FAI_VALIDATION_FOLDER_NAME = "FAI / Validation";

/** Folder Explorer deep link. The web app uses this same query. */
export const FAI_VALIDATION_DOCUMENTS_PATH = `/documents/folders?name=${encodeURIComponent(FAI_VALIDATION_FOLDER_NAME)}`;

/** Old Validation Reports folder page. The web app redirects this to FAI / Validation. */
export const LEGACY_VALIDATION_REPORTS_PATH = "/folders/validation-reports";

/** One Quality/Training folder to fold into the ISO Training drawer. `destId` null reparents the source onto ISO. */
export interface QualityTrainingRepair {
  sourceId: number;
  destId: number | null;
  isoId: number;
}

function descendsFrom(folders: FolderIdentity[], nodeId: number, ancestorId: number): boolean {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let current = byId.get(nodeId);
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.parentId === ancestorId) return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

/** One legacy Quality FAI drawer to rename, or to fold into an existing FAI / Validation folder. */
export interface FaiValidationRepair {
  sourceId: number;
  /** When set, merge the legacy FAI folder into this one. When null, rename the source in place. */
  destId: number | null;
}

function parentName(folders: FolderIdentity[], folder: FolderIdentity): string | undefined {
  if (folder.parentId == null) return undefined;
  return folders.find((row) => row.id === folder.parentId)?.name;
}

/** Blank Form Templates only. A company folder under ISO is not in that shelf. */
function inBlankTemplates(folder: FolderIdentity, folders: FolderIdentity[]): boolean {
  const byId = new Map(folders.map((row) => [row.id, row]));
  let current: FolderIdentity | undefined = folder;
  const seen = new Set<number>();
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    if (current.name === "Blank Form Templates" || current.name === "Blank Forms Templates") return true;
    current = current.parentId == null ? undefined : byId.get(current.parentId);
  }
  return false;
}

/**
 * Rename the company FAI drawer to FAI / Validation without creating a second row.
 * "First Article Inspection (FAI)" and Engineering "Validation" folders are different names.
 * A copy that lives in the blank-template library is not the company drawer.
 */
export function planFaiValidationRepair(folders: FolderIdentity[]): FaiValidationRepair[] {
  const legacy = folders
    .filter((folder) => folder.name === LEGACY_FAI_FOLDER_NAME && !inBlankTemplates(folder, folders))
    .sort((a, b) => {
      const aQuality = parentName(folders, a) === QUALITY_FOLDER_NAME ? 0 : 1;
      const bQuality = parentName(folders, b) === QUALITY_FOLDER_NAME ? 0 : 1;
      return aQuality - bQuality || a.id - b.id;
    });
  if (legacy.length === 0) return [];

  const canonical = folders
    .filter((folder) => folder.name === FAI_VALIDATION_FOLDER_NAME && !inBlankTemplates(folder, folders))
    .sort((a, b) => a.id - b.id)[0];

  const repairs: FaiValidationRepair[] = [];
  let destId = canonical?.id ?? null;
  for (const source of legacy) {
    if (destId != null && (source.id === destId || descendsFrom(folders, destId, source.id))) continue;
    if (destId == null) {
      repairs.push({ sourceId: source.id, destId: null });
      destId = source.id;
      continue;
    }
    repairs.push({ sourceId: source.id, destId });
  }
  return repairs;
}

/**
 * Quality must not keep a Training child. Prefer the Training folder that
 * already sits under ISO, then a Training folder someone moved out of the
 * template library. The first Quality/Training is reparented only when no
 * other Training drawer exists yet.
 */
export function planQualityTrainingRepair(folders: FolderIdentity[]): QualityTrainingRepair[] {
  const iso = folders.find((folder) => folder.parentId == null && folder.name === ISO_FOLDER_NAME);
  if (!iso) return [];
  const qualityIds = new Set(folders.filter((folder) => folder.name === QUALITY_FOLDER_NAME).map((folder) => folder.id));
  const sources = folders
    .filter((folder) => folder.name === TRAINING_FOLDER_NAME && folder.parentId != null && qualityIds.has(folder.parentId))
    .sort((a, b) => a.id - b.id);
  if (sources.length === 0) return [];

  const sourceIds = new Set(sources.map((folder) => folder.id));
  const isoTraining = folders.find((folder) => folder.parentId === iso.id && folder.name === TRAINING_FOLDER_NAME && !sourceIds.has(folder.id));
  const movedTraining = folders.find((folder) => folder.name === TRAINING_FOLDER_NAME && !sourceIds.has(folder.id) && !inTemplateLibrary(folder, folders));
  const canonical = isoTraining ?? movedTraining;
  const repairs: QualityTrainingRepair[] = [];
  let destId = canonical?.id ?? null;
  for (const source of sources) {
    if (destId != null && (source.id === destId || descendsFrom(folders, destId, source.id))) continue;
    if (destId == null) {
      repairs.push({ sourceId: source.id, destId: null, isoId: iso.id });
      destId = source.id;
      continue;
    }
    repairs.push({ sourceId: source.id, destId, isoId: iso.id });
  }
  return repairs;
}

function hasFolderPayload(folder: FolderRow): boolean {
  return folder.pdfPath != null || folder.documentId != null || folder.linkedPath != null;
}

/**
 * Same merge as migration 0094's accuqual_merge_document_folder: children move
 * or fold by name, filings and blank-template rows follow, and a saved file
 * is copied onto an empty destination. A source that still holds a file is
 * kept as a child instead of deleted.
 */
async function mergeDocumentFolder(db: Db, list: FolderRow[], sourceId: number, destId: number, depth = 0): Promise<FolderRow[]> {
  if (sourceId === destId || depth > 50) return list;
  if (descendsFrom(list, destId, sourceId)) return list;

  const children = list.filter((folder) => folder.parentId === sourceId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  for (const child of children) {
    const existing = list.filter((folder) => folder.parentId === destId && folder.id !== child.id && folderIdentityKey(folder.name) === folderIdentityKey(child.name)).sort((a, b) => a.id - b.id)[0];
    if (!existing) {
      await db.update(documentFolders).set({ parentId: destId, updatedAt: new Date() }).where(eq(documentFolders.id, child.id));
      list = list.map((folder) => (folder.id === child.id ? { ...folder, parentId: destId } : folder));
    } else {
      list = await mergeDocumentFolder(db, list, child.id, existing.id, depth + 1);
    }
  }

  await db.update(formFilings).set({ folderNodeId: destId, updatedAt: new Date() }).where(eq(formFilings.folderNodeId, sourceId));
  await db.update(controlledFormTemplates).set({ folderId: destId }).where(eq(controlledFormTemplates.folderId, sourceId));

  const source = list.find((folder) => folder.id === sourceId);
  const dest = list.find((folder) => folder.id === destId);
  const childLeft = list.some((folder) => folder.parentId === sourceId);
  if (source && dest && !childLeft && hasFolderPayload(source) && !hasFolderPayload(dest)) {
    const moved = source;
    await db
      .update(documentFolders)
      .set({
        pdfPath: moved.pdfPath,
        pdfMimeType: moved.pdfMimeType,
        documentId: moved.documentId,
        linkedPath: moved.linkedPath,
        updatedAt: new Date(),
      })
      .where(eq(documentFolders.id, destId));
    await db
      .update(documentFolders)
      .set({ pdfPath: null, pdfMimeType: null, documentId: null, linkedPath: null, updatedAt: new Date() })
      .where(eq(documentFolders.id, sourceId));
    list = list.map((folder) => {
      if (folder.id === destId) {
        return { ...folder, pdfPath: moved.pdfPath, pdfMimeType: moved.pdfMimeType, documentId: moved.documentId, linkedPath: moved.linkedPath };
      }
      if (folder.id === sourceId) return { ...folder, pdfPath: null, pdfMimeType: null, documentId: null, linkedPath: null };
      return folder;
    });
  }

  const sourceNow = list.find((folder) => folder.id === sourceId);
  if (!sourceNow) return list;
  if (hasFolderPayload(sourceNow)) {
    // Two filings of the same living list are one item. Nesting the copy
    // under the keeper made the path read LST-ENG-001\LST-ENG-001.
    const sameLivingList = sourceNow.linkedPath != null && sourceNow.linkedPath === dest?.linkedPath && sourceNow.name === dest?.name && !list.some((folder) => folder.parentId === sourceNow.id);
    if (sameLivingList) {
      await db.delete(documentFolders).where(eq(documentFolders.id, sourceId));
      return list.filter((folder) => folder.id !== sourceId);
    }
    await db.update(documentFolders).set({ parentId: destId, updatedAt: new Date() }).where(eq(documentFolders.id, sourceId));
    return list.map((folder) => (folder.id === sourceId ? { ...folder, parentId: destId } : folder));
  }
  if (!list.some((folder) => folder.parentId === sourceId)) {
    await db.delete(documentFolders).where(eq(documentFolders.id, sourceId));
    return list.filter((folder) => folder.id !== sourceId);
  }
  return list;
}

export interface FolderContentMove {
  id: number;
  name: string;
  fromParentId: number | null;
  toParentId: number;
  fromLabel: string;
  toLabel: string;
}

function containerRow(list: FolderRow[], folder: FolderRow): boolean {
  if (list.some((row) => row.parentId === folder.id)) return true;
  return !hasFolderPayload(folder);
}

/**
 * Moves everything inside a folder to `destinationId`, folding a same-named
 * container into the one already there. A folder that itself holds a file
 * moves as that file and is not deleted. An emptied container is deleted.
 */
export async function moveDocumentFolderContents(
  db: Db,
  list: FolderRow[],
  sourceId: number,
  destinationId: number,
): Promise<{ list: FolderRow[]; moves: FolderContentMove[]; removedId: number | null }> {
  const source = list.find((folder) => folder.id === sourceId);
  if (!source) return { list, moves: [], removedId: null };
  const moves: FolderContentMove[] = [];
  const children = list.filter((folder) => folder.parentId === sourceId).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  let current = list;
  for (const child of children) {
    const fromLabel = folderLocationLabel(current, child.parentId);
    const toLabel = folderLocationLabel(current, destinationId);
    const existing = current
      .filter((folder) => folder.parentId === destinationId && folder.id !== child.id && folderIdentityKey(folder.name) === folderIdentityKey(child.name))
      .sort((a, b) => a.id - b.id)[0];
    if (existing && containerRow(current, child) && containerRow(current, existing)) {
      current = await mergeDocumentFolder(db, current, child.id, existing.id);
    } else {
      await db.update(documentFolders).set({ parentId: destinationId, updatedAt: new Date() }).where(eq(documentFolders.id, child.id));
      current = current.map((folder) => (folder.id === child.id ? { ...folder, parentId: destinationId } : folder));
    }
    moves.push({ id: child.id, name: child.name, fromParentId: sourceId, toParentId: destinationId, fromLabel, toLabel });
  }

  const left = current.find((folder) => folder.id === sourceId);
  if (!left) return { list: current, moves, removedId: sourceId };
  if (hasFolderPayload(left) || current.some((folder) => folder.parentId === left.id)) {
    const fromLabel = folderLocationLabel(current, left.parentId);
    const toLabel = folderLocationLabel(current, destinationId);
    await db.update(documentFolders).set({ parentId: destinationId, updatedAt: new Date() }).where(eq(documentFolders.id, left.id));
    current = current.map((folder) => (folder.id === left.id ? { ...folder, parentId: destinationId } : folder));
    moves.push({ id: left.id, name: left.name, fromParentId: left.parentId, toParentId: destinationId, fromLabel, toLabel });
    return { list: current, moves, removedId: null };
  }
  await db.delete(documentFolders).where(eq(documentFolders.id, left.id));
  return { list: current.filter((folder) => folder.id !== left.id), moves, removedId: left.id };
}

async function repairFaiValidation(db: Db, list: FolderRow[]): Promise<FolderRow[]> {
  let current = list;
  for (const move of planFaiValidationRepair(current)) {
    if (move.destId == null) {
      const [updated] = await db
        .update(documentFolders)
        .set({ name: FAI_VALIDATION_FOLDER_NAME, updatedAt: new Date() })
        .where(eq(documentFolders.id, move.sourceId))
        .returning();
      if (updated) current = current.map((folder) => (folder.id === updated.id ? updated : folder));
      continue;
    }
    current = await mergeDocumentFolder(db, current, move.sourceId, move.destId);
  }
  return current;
}

async function repairQualityTraining(db: Db, list: FolderRow[]): Promise<FolderRow[]> {
  let current = list;
  for (const move of planQualityTrainingRepair(current)) {
    if (move.destId == null) {
      const [updated] = await db
        .update(documentFolders)
        .set({ parentId: move.isoId, updatedAt: new Date() })
        .where(eq(documentFolders.id, move.sourceId))
        .returning();
      if (updated) current = current.map((folder) => (folder.id === updated.id ? updated : folder));
      continue;
    }
    current = await mergeDocumentFolder(db, current, move.sourceId, move.destId);
  }
  return current;
}

/** Inserts any missing drawers. Returns the list including rows just created. A deleted folder stays deleted. */
export async function ensureCompanyDocumentFolders(db: Db, all: FolderRow[]): Promise<FolderRow[]> {
  let list = await repairFaiValidation(db, all);
  const removed = await deletedDocumentFolderTokens(db);

  async function ensureLevel(nodes: DefaultFolderSeed[], parentId: number | null): Promise<void> {
    const parentName = parentId == null ? null : list.find((folder) => folder.id === parentId)?.name ?? null;
    for (const node of nodes) {
      let current = locateSeedFolder(list, node.name, parentId);
      if (!current && isTombstoned(removed, parentName, node.name)) continue;
      if (!current) {
        const siblingCount = list.filter((folder) => folder.parentId === parentId).length;
        const [created] = await db
          .insert(documentFolders)
          .values({ name: node.name, parentId: parentId ?? undefined, sortOrder: siblingCount })
          .returning();
        if (!created) throw new Error(`Could not create the ${node.name} folder`);
        list = [...list, created];
        current = created;
      }
      if (!current) continue;
      if (node.children.length > 0) await ensureLevel(node.children, current.id);
    }
  }

  await ensureLevel(COMPANY_DOCUMENT_FOLDERS, null);
  list = await repairQualityTraining(db, list);
  list = await retireNamedDocumentFolders(db, list);
  return ensureMainIsoFolders(db, list);
}

function folderDepth(folders: FolderRow[], id: number): number {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  let depth = 0;
  let current = byId.get(id);
  const seen = new Set<number>();
  while (current?.parentId != null && !seen.has(current.id)) {
    seen.add(current.id);
    depth += 1;
    current = byId.get(current.parentId);
  }
  return depth;
}

const WRAPPER_KEEP_NAMES = new Set<string>([ISO_FOLDER_NAME, "Library Pool", ...MAIN_ISO_FOLDER_NAMES]);

/**
 * Drops a parent that the fold just emptied. A drawer directly under ISO,
 * a main folder, and anything that still holds a file or a child stays.
 */
async function removeEmptyWrappers(db: Db, list: FolderRow[], startId: number | null): Promise<FolderRow[]> {
  let current = list;
  let id = startId;
  while (id != null) {
    const folder = current.find((row) => row.id === id);
    if (!folder) break;
    const parentId = folder.parentId;
    if (WRAPPER_KEEP_NAMES.has(folder.name) || folder.parentId == null || inTemplateLibrary(folder, current)) break;
    const iso = current.find((row) => row.parentId == null && row.name === ISO_FOLDER_NAME);
    if (iso && folder.parentId === iso.id) break;
    if (current.some((row) => row.parentId === folder.id) || hasFolderPayload(folder)) break;
    const [filing] = await db.select({ id: formFilings.id }).from(formFilings).where(eq(formFilings.folderNodeId, folder.id)).limit(1);
    if (filing) break;
    const [template] = await db.select({ id: controlledFormTemplates.id }).from(controlledFormTemplates).where(eq(controlledFormTemplates.folderId, folder.id)).limit(1);
    if (template) break;
    await db.delete(documentFolders).where(eq(documentFolders.id, folder.id));
    current = current.filter((row) => row.id !== folder.id);
    id = parentId;
  }
  return current;
}

const BLANK_DRAWER_NAMES = [BLANK_FORMS_FOLDER, PREVIOUS_BLANK_FORMS_FOLDER] as const;

function fillableTopics(): string[] {
  return [...new Set(FORM_TEMPLATES.filter((seed) => !keptOutOfBlankFormsTemplates(seed)).map((seed) => seed.topic))];
}

function topicForFormKey(formKey: string): string | null {
  const seed = FORM_TEMPLATES.find((row) => row.formKey === formKey);
  if (!seed || keptOutOfBlankFormsTemplates(seed) || !seed.start) return null;
  return seed.topic;
}

function formKeyOfShortcut(folder: { linkedPath?: string | null }): string | null {
  if (!folder.linkedPath?.startsWith(BLANK_TEMPLATE_START_PREFIX)) return null;
  return folder.linkedPath.slice(BLANK_TEMPLATE_START_PREFIX.length);
}

function resolveBlankShelf(list: FolderRow[], profileShelfId: number | undefined): FolderRow | undefined {
  const stored = profileShelfId != null ? list.find((folder) => folder.id === profileShelfId) : undefined;
  if (stored) return stored;
  const iso = list.find((folder) => folder.parentId == null && folder.name === ISO_FOLDER_NAME);
  if (!iso) return list.find((folder) => folder.name === BLANK_FORMS_FOLDER);
  return list.find((folder) => folder.parentId === iso.id && folder.name === BLANK_FORMS_FOLDER);
}

/** Renames a clashing topic in place. When the Forms name already exists, the old topic folds into it. */
async function renameBlankTopic(db: Db, list: FolderRow[], rename: BlankTopicRename, performedBy?: number): Promise<FolderRow[]> {
  const source = list.find((folder) => folder.id === rename.folderId);
  if (!source || source.name === rename.toName) return list;
  const sibling = list.find((folder) => folder.parentId === source.parentId && folder.id !== source.id && folder.name === rename.toName);
  const parentLabel = folderLocationLabel(list, source.parentId);
  if (!sibling) {
    await db.update(documentFolders).set({ name: rename.toName, updatedAt: new Date() }).where(eq(documentFolders.id, source.id));
    await recordAuditTrail(db, {
      entityType: "DocumentFolder",
      entityId: source.id,
      action: "update",
      performedBy,
      changes: folderRenameAudit(`${parentLabel} / ${source.name}`, `${parentLabel} / ${rename.toName}`),
    });
    return list.map((folder) => (folder.id === source.id ? { ...folder, name: rename.toName } : folder));
  }
  const fromLabel = `${parentLabel} / ${source.name}`;
  const toLabel = `${parentLabel} / ${sibling.name}`;
  const merged = await mergeDocumentFolder(db, list, source.id, sibling.id);
  await recordAuditTrail(db, {
    entityType: "DocumentFolder",
    entityId: sibling.id,
    action: "update",
    performedBy,
    changes: {
      event: "merged",
      summary: `Merged the duplicate folder "${source.name}" from ${fromLabel} → ${toLabel}. Subfolders and saved items moved with it.`,
      name: source.name,
      from: fromLabel,
      to: toLabel,
      sourceId: source.id,
      destId: sibling.id,
    },
  });
  return merged;
}

async function applyBlankTopicRenames(db: Db, list: FolderRow[], shelfId: number, performedBy?: number): Promise<FolderRow[]> {
  let current = list;
  for (const rename of planBlankTopicRenames(current, shelfId, fillableTopics(), BLANK_DRAWER_NAMES)) {
    current = await renameBlankTopic(db, current, rename, performedBy);
  }
  return current;
}

/**
 * Puts blank shortcuts back under Blank Forms Templates.
 * When `onlyWhenTopicMissing` is set, a shortcut stays where someone moved it
 * once the topic folder is already on the shelf. The earlier fold deleted that
 * folder, so those blanks still come back.
 */
async function returnMisfiledBlanks(db: Db, list: FolderRow[], shelfId: number, performedBy: number | undefined, onlyWhenTopicMissing: boolean): Promise<FolderRow[]> {
  const outside = namesOutsideBlankDrawers(list, BLANK_DRAWER_NAMES);
  const planned = planBlankShortcutReturns(list, shelfId, formKeyOfShortcut, topicForFormKey, outside);
  const byTopic = new Map<string, typeof planned>();
  for (const item of planned) {
    const group = byTopic.get(item.topic) ?? [];
    group.push(item);
    byTopic.set(item.topic, group);
  }

  let current = list;
  for (const [topic, items] of byTopic) {
    const folderName = items[0]?.folderName;
    if (!folderName) continue;
    let home = current.find((folder) => folder.parentId === shelfId && !folder.linkedPath && (folder.name === folderName || folder.name === topic));
    if (onlyWhenTopicMissing && home) continue;
    if (home && home.name !== folderName) {
      current = await renameBlankTopic(db, current, { folderId: home.id, fromName: home.name, toName: folderName }, performedBy);
      home = current.find((folder) => folder.id === home!.id && folder.name === folderName) ?? current.find((folder) => folder.parentId === shelfId && folder.name === folderName && !folder.linkedPath);
    }
    if (!home) {
      const siblings = current.filter((folder) => folder.parentId === shelfId);
      const [created] = await db.insert(documentFolders).values({ name: folderName, parentId: shelfId, sortOrder: siblings.length }).returning();
      if (!created) continue;
      current = [...current, created];
      home = created;
    }
    if (!home) continue;
    for (const item of items) {
      const shortcut = current.find((folder) => folder.id === item.shortcutId);
      if (!shortcut || shortcut.parentId === home.id) continue;
      const fromPath = itemFolderPath(current, shortcut.parentId, shortcut.name);
      const toPath = itemFolderPath(current, home.id, shortcut.name);
      await db.update(documentFolders).set({ parentId: home.id, updatedAt: new Date() }).where(eq(documentFolders.id, shortcut.id));
      await db.update(controlledFormTemplates).set({ folderId: home.id }).where(eq(controlledFormTemplates.formKey, item.formKey));
      current = current.map((folder) => (folder.id === shortcut.id ? { ...folder, parentId: home!.id } : folder));
      await recordAuditTrail(db, {
        entityType: "DocumentFolder",
        entityId: shortcut.id,
        action: "update",
        performedBy,
        changes: {
          event: "moved",
          summary: `Moved the blank form template "${shortcut.name}" from ${fromPath} → ${toPath}.`,
          name: shortcut.name,
          from: fromPath,
          to: toPath,
          fromPath,
          toPath,
          fromParentId: shortcut.parentId,
          toParentId: home.id,
        },
      });
    }
  }
  return current;
}

const MERGE_OPTIONS = {
  isoName: ISO_FOLDER_NAME,
  blankShelfNames: ["Blank Forms Templates"],
  legacyDrawerNames: ["Blank Form Templates"],
  mainIsoNames: MAIN_ISO_FOLDER_NAMES,
  canonicalHomes: CANONICAL_FOLDER_HOMES,
};

async function applyFolderMerges(db: Db, list: FolderRow[], plan: { sourceId: number; destId: number }[], performedBy?: number): Promise<FolderRow[]> {
  const ordered = [...plan].sort((a, b) => folderDepth(list, b.sourceId) - folderDepth(list, a.sourceId) || a.sourceId - b.sourceId);
  let current = list;
  for (const move of ordered) {
    const source = current.find((folder) => folder.id === move.sourceId);
    const dest = current.find((folder) => folder.id === move.destId);
    if (!source || !dest || descendsFrom(current, dest.id, source.id)) continue;
    const fromParentId = source.parentId;
    const fromLabel = `${folderLocationLabel(current, source.parentId)} / ${source.name}`;
    const toLabel = `${folderLocationLabel(current, dest.parentId)} / ${dest.name}`;
    current = await mergeDocumentFolder(db, current, source.id, dest.id);
    current = await removeEmptyWrappers(db, current, fromParentId);
    await recordAuditTrail(db, {
      entityType: "DocumentFolder",
      entityId: dest.id,
      action: "update",
      performedBy,
      changes: {
        event: "merged",
        summary: `Merged the duplicate folder "${source.name}" from ${fromLabel} → ${toLabel}. Subfolders and saved items moved with it.`,
        name: source.name,
        from: fromLabel,
        to: toLabel,
        sourceId: source.id,
        destId: dest.id,
      },
    });
  }
  return current;
}

/**
 * Case, space, and number-prefix copies of one name fold every time the
 * folder list is read. An exact second copy made after the one-time fold
 * is not part of this pass.
 */
export async function mergeLooseFolderDuplicates(db: Db, list: FolderRow[], performedBy?: number): Promise<FolderRow[]> {
  const plan = planLooseFolderMerges(list, MERGE_OPTIONS);
  if (plan.length === 0) return list;
  return applyFolderMerges(db, list, plan, performedBy);
}

/**
 * Folds every repeated company folder name into one home, once per company.
 * Blank topic folders stay under Blank Forms Templates. A topic whose name
 * matches a company folder is renamed with " Forms" on that same pass.
 * A main drawer Shawn deleted is not recreated. Opening Documents again
 * does not run the exact-name fold a second time, so a pair created later stays.
 * A company that already ran the fold and had blanks moved out gets those
 * blanks back. A blank moved after that stays where it was put.
 * Spelling variants still fold on every later open.
 */
export async function mergeDuplicateFoldersOnce(db: Db, list: FolderRow[], performedBy?: number): Promise<FolderRow[]> {
  const [row] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  if (!row) return list;

  if (row.profile?.folderNamesUnified === true) {
    const shelf = resolveBlankShelf(list, row.profile.blankFormsTemplatesFolderId);
    const current = shelf ? await returnMisfiledBlanks(db, list, shelf.id, performedBy, true) : list;
    return mergeLooseFolderDuplicates(db, current, performedBy);
  }

  let current = await applyFolderMerges(db, list, planDuplicateFolderMerges(list, MERGE_OPTIONS), performedBy);

  const shelf = resolveBlankShelf(current, row.profile?.blankFormsTemplatesFolderId);
  if (shelf) {
    current = await applyBlankTopicRenames(db, current, shelf.id, performedBy);
    current = await returnMisfiledBlanks(db, current, shelf.id, performedBy, false);
  }
  current = await mergeLooseFolderDuplicates(db, current, performedBy);

  const [fresh] = await db.select({ id: company.id, profile: company.profile }).from(company).limit(1);
  if (fresh) {
    await db
      .update(company)
      .set({ profile: { ...(fresh.profile ?? {}), duplicateFoldersMerged: true, folderNamesUnified: true } })
      .where(eq(company.id, fresh.id));
  }
  return current;
}

/**
 * A blank whose topic folder is missing goes back under Blank Forms Templates.
 * When every topic is already there, this does not write.
 */
export async function rehomeStrayBlankShortcuts(db: Db, list: FolderRow[], profileShelfId: number | undefined, performedBy?: number): Promise<FolderRow[]> {
  const shelf = resolveBlankShelf(list, profileShelfId);
  if (!shelf) return list;
  return returnMisfiledBlanks(db, list, shelf.id, performedBy, true);
}
