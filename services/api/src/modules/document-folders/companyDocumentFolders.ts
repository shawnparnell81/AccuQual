/**
 * Shawn's Documents drawers, nested under ISO Compliance Documents.
 * Created the first time the folder list loads, and again later only where a
 * name is still missing. No schema change: an existing folder under the same
 * parent is left where an admin put it. A name that appears once here is
 * reused if someone moved it, unless that copy sits in the blank-template
 * library (those names are reused on purpose, like "Training" and "Validation").
 * Moving an existing company onto this layout is the job of migration
 * 0094_iso_compliance_folder_tree. This seed does not reparent folders.
 */
import type { Db } from "../../lib/requestDb.js";
import { documentFolders } from "../../drizzle/schema/documentFolders.js";
import type { DefaultFolderSeed } from "./defaultDocumentFolders.js";

const TEMPLATE_LIBRARY_NAMES = new Set(["Blank Form Templates", "ISO Compliance Documents"]);

function productLine(name: string): DefaultFolderSeed {
  return {
    name,
    children: [
      { name: "Validation", children: [] },
      { name: "Development", children: [] },
    ],
  };
}

export const COMPANY_DOCUMENT_FOLDERS: DefaultFolderSeed[] = [
  {
    name: "ISO Compliance Documents",
    children: [
      {
        name: "Engineering",
        children: [productLine("CSA"), productLine("Fuel"), productLine("Shocks"), productLine("Air Suspension"), productLine("Gas/Electric Lifts")],
      },
      {
        name: "Quality",
        children: [
          {
            name: "FAI",
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
          { name: "Training", children: [] },
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

/** Inserts any missing drawers. Returns the list including rows just created. */
export async function ensureCompanyDocumentFolders(db: Db, all: FolderRow[]): Promise<FolderRow[]> {
  let list = all;

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
  return list;
}
