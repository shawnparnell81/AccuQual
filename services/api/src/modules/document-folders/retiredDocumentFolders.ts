/**
 * Folders the owner asked to take out of the document library.
 * The names are the built-in taxonomy in defaultDocumentFolders.ts.
 * Companies that already have those rows keep them in the database.
 * This only decides what the library is allowed to show.
 */

export const HIDDEN_ROOTS = new Set(["Customer Service", "Sales and Marketing", "Purchasing"]);

/** Direct children of these departments that leave the library, along with everything inside them. */
export const HIDDEN_CHILDREN: Record<string, Set<string>> = {
  "Material Management": new Set([
    "Raw Materials",
    "WIP",
    "Finished Goods",
    "Traceability",
    "Material Certifications",
    "Material Certification",
    "Storage & Handling",
    "Storage and Handling",
    "Material Planning",
  ]),
};

/**
 * When a department is listed here, only these branches stay.
 * A kept folder keeps its own children.
 * A kept name buried under a removed parent is lifted up to the department in the response only.
 * After 0094_iso_compliance_folder_tree, Training and Safety are no longer under Production,
 * so Production shows empty. This list still hides any older production branches that remain.
 */
export const KEEP_BRANCHES: Record<string, Set<string>> = {
  "Shipping & Receiving": new Set([
    "Receiving Inspection",
    "Receiving Inspection Reports",
    "Incoming Inspection Record",
    "Supplier NCRs",
    "Supplier Nonconformance Reports (Create NCR's Only)",
  ]),
  Production: new Set(["Training & Competency", "Training and Competency", "Safety", "Safety & Compliance"]),
};

export interface FolderRef {
  id: number;
  parentId: number | null;
  name: string;
}

export function presentDocumentFolders<T extends FolderRef>(folders: T[]): T[] {
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const children = new Map<number | null, T[]>();
  for (const folder of folders) {
    const list = children.get(folder.parentId) ?? [];
    list.push(folder);
    children.set(folder.parentId, list);
  }
  const hidden = new Set<number>();

  function hideTree(node: T) {
    hidden.add(node.id);
    for (const child of children.get(node.id) ?? []) hideTree(child);
  }

  function subtreeHasKeep(node: T, keep: Set<string>): boolean {
    if (keep.has(node.name)) return true;
    return (children.get(node.id) ?? []).some((child) => subtreeHasKeep(child, keep));
  }

  function isIsoRoot(node: T): boolean {
    return node.parentId === null && node.name === "ISO Compliance Documents";
  }

  /** Roots, and the departments nested directly under ISO Compliance Documents. */
  function actsAsDepartment(node: T): boolean {
    if (node.parentId === null) return true;
    const parent = byId.get(node.parentId);
    return parent != null && isIsoRoot(parent);
  }

  function walk(node: T, department: string | null, keptAncestor: boolean) {
    if (actsAsDepartment(node)) {
      if (isIsoRoot(node)) {
        for (const child of children.get(node.id) ?? []) walk(child, null, false);
        return;
      }
      if (HIDDEN_ROOTS.has(node.name)) {
        hideTree(node);
        return;
      }
      for (const child of children.get(node.id) ?? []) walk(child, node.name, false);
      return;
    }

    const dept = department ?? "";
    if (HIDDEN_CHILDREN[dept]?.has(node.name)) {
      hideTree(node);
      return;
    }

    const keep = KEEP_BRANCHES[dept];
    if (!keep) {
      for (const child of children.get(node.id) ?? []) walk(child, dept, false);
      return;
    }
    if (keptAncestor || keep.has(node.name)) {
      for (const child of children.get(node.id) ?? []) walk(child, dept, true);
      return;
    }
    if (subtreeHasKeep(node, keep)) {
      hidden.add(node.id);
      for (const child of children.get(node.id) ?? []) walk(child, dept, false);
      return;
    }
    hideTree(node);
  }

  for (const root of children.get(null) ?? []) walk(root, null, false);

  function nearestVisible(parentId: number | null): number | null {
    let cursor = parentId;
    const seen = new Set<number>();
    while (cursor !== null) {
      if (!hidden.has(cursor)) return cursor;
      if (seen.has(cursor)) return null;
      seen.add(cursor);
      cursor = byId.get(cursor)?.parentId ?? null;
    }
    return null;
  }

  return folders
    .filter((folder) => !hidden.has(folder.id))
    .map((folder) => {
      if (folder.parentId !== null && hidden.has(folder.parentId)) {
        return { ...folder, parentId: nearestVisible(folder.parentId) };
      }
      return folder;
    });
}
