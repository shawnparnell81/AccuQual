/**
 * Shawn's Documents drawers, nested under ISO Compliance Documents.
 * Created the first time the folder list loads, and again later only where a
 * name is still missing. No schema change: an existing folder under the same
 * parent is left where an admin put it. A name that appears once here is
 * reused if someone moved it, unless that copy sits in the blank-template
 * library (those names are reused on purpose, like "Training" and "Validation").
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
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import { controlledFormTemplates } from "../../drizzle/schema/controlledForms.js";
import { formFilings } from "../../drizzle/schema/formFilings.js";
import type { DefaultFolderSeed } from "./defaultDocumentFolders.js";
import { ensureMainIsoFolders } from "./mainIsoFolders.js";
import { retireNamedDocumentFolders } from "./retiredFolderCleanup.js";

const TEMPLATE_LIBRARY_NAMES = new Set(["Blank Form Templates", "Blank Forms Templates", "ISO Compliance Documents"]);

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
        children: [
          { name: "Policies", children: [] },
          { name: "Procedures", children: [] },
        ],
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

/** Blank Form Templates only. inTemplateLibrary also matches ISO, which is where this drawer lives. */
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
    const existing = list.filter((folder) => folder.parentId === destId && folder.name === child.name).sort((a, b) => a.id - b.id)[0];
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
    await db.update(documentFolders).set({ parentId: destId, updatedAt: new Date() }).where(eq(documentFolders.id, sourceId));
    return list.map((folder) => (folder.id === sourceId ? { ...folder, parentId: destId } : folder));
  }
  if (!list.some((folder) => folder.parentId === sourceId)) {
    await db.delete(documentFolders).where(eq(documentFolders.id, sourceId));
    return list.filter((folder) => folder.id !== sourceId);
  }
  return list;
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

/** Inserts any missing drawers. Returns the list including rows just created. */
export async function ensureCompanyDocumentFolders(db: Db, all: FolderRow[]): Promise<FolderRow[]> {
  let list = await repairFaiValidation(db, all);

  async function ensureLevel(nodes: DefaultFolderSeed[], parentId: number | null): Promise<void> {
    for (const node of nodes) {
      let current = locateSeedFolder(list, node.name, parentId);
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
      if (node.children.length > 0) await ensureLevel(node.children, current.id);
    }
  }

  await ensureLevel(COMPANY_DOCUMENT_FOLDERS, null);
  list = await repairQualityTraining(db, list);
  list = await retireNamedDocumentFolders(db, list);
  return ensureMainIsoFolders(db, list);
}
