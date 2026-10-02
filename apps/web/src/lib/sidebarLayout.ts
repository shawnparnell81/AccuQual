import { SIDEBAR_FOLDERS, isFolder, type SidebarFolder, type SidebarNode } from "../components/layout/sidebarStructure";

/** Saved order and nesting. Labels and routes stay in the app catalog. */
export interface SidebarPlacement {
  key: string;
  children?: SidebarPlacement[];
}

export function defaultPlacements(nodes: SidebarNode[] = SIDEBAR_FOLDERS): SidebarPlacement[] {
  return nodes.map((node) => (isFolder(node) ? { key: node.key, children: defaultPlacements(node.children) } : { key: node.key }));
}

function indexCatalog(nodes: SidebarNode[], map = new Map<string, SidebarNode>()): Map<string, SidebarNode> {
  for (const node of nodes) {
    map.set(node.key, node);
    if (isFolder(node)) indexCatalog(node.children, map);
  }
  return map;
}

function findFolder(nodes: SidebarNode[], key: string): SidebarFolder | null {
  for (const node of nodes) {
    if (!isFolder(node)) continue;
    if (node.key === key) return node;
    const nested = findFolder(node.children, key);
    if (nested) return nested;
  }
  return null;
}

function materialize(items: SidebarPlacement[], catalog: Map<string, SidebarNode>, used: Set<string>): SidebarNode[] {
  const out: SidebarNode[] = [];
  for (const item of items) {
    const source = catalog.get(item.key);
    if (!source || used.has(item.key)) continue;
    used.add(item.key);
    if (isFolder(source)) {
      out.push({ ...source, children: materialize(item.children ?? [], catalog, used) });
    } else {
      out.push(source);
    }
  }
  return out;
}

function insertMissing(defaults: SidebarNode[], parentKey: string | null, built: SidebarNode[], used: Set<string>) {
  for (const node of defaults) {
    if (!used.has(node.key)) {
      used.add(node.key);
      const copy: SidebarNode = isFolder(node) ? { ...node, children: [] } : node;
      if (parentKey === null) built.push(copy);
      else {
        const parent = findFolder(built, parentKey);
        if (parent) parent.children.push(copy);
        else built.push(copy);
      }
    }
    if (isFolder(node)) insertMissing(node.children, node.key, built, used);
  }
}

function qualityOwnedKeys(catalog: SidebarNode[]): Set<string> {
  const quality = catalog.find((node) => node.key === "quality");
  const keys = new Set<string>();
  if (quality && isFolder(quality)) {
    for (const child of quality.children) keys.add(child.key);
  }
  return keys;
}

function takeNode(nodes: SidebarNode[], key: string): SidebarNode | null {
  const index = nodes.findIndex((node) => node.key === key);
  if (index >= 0) return nodes.splice(index, 1)[0] ?? null;
  for (const node of nodes) {
    if (!isFolder(node)) continue;
    const found = takeNode(node.children, key);
    if (found) return found;
  }
  return null;
}

/**
 * Document Control is a top-level section immediately above Quality.
 * A saved arrangement that still nests it under Quality, or that parked
 * Quality items inside it, is put back. The objects come from materialize,
 * so this does not rewrite the catalog.
 */
export function hoistDocumentControl(nodes: SidebarNode[], catalog: SidebarNode[] = SIDEBAR_FOLDERS): SidebarNode[] {
  const nestedControl = findNode(nodes, "document-control");
  if (nestedControl && isFolder(nestedControl) && findNode(nestedControl.children, "quality")) {
    const quality = takeNode(nodes, "quality");
    if (quality) nodes.push(quality);
  }
  const control = takeNode(nodes, "document-control");
  if (!control || !isFolder(control)) return nodes;
  const ownedByQuality = qualityOwnedKeys(catalog);
  const misplaced: SidebarNode[] = [];
  const kept: SidebarNode[] = [];
  for (const child of control.children) {
    if (ownedByQuality.has(child.key)) misplaced.push(child);
    else kept.push(child);
  }
  control.children = kept;
  const quality = findNode(nodes, "quality");
  if (quality && isFolder(quality)) {
    const present = new Set(quality.children.map((child) => child.key));
    for (const child of misplaced) {
      if (!present.has(child.key)) quality.children.push(child);
    }
  }
  const qualityIndex = nodes.findIndex((node) => node.key === "quality");
  if (qualityIndex >= 0) nodes.splice(qualityIndex, 0, control);
  else nodes.unshift(control);
  return nodes;
}

/** Applies a saved arrangement. New catalog items appear in their usual section. */
export function applySidebarLayout(saved: SidebarPlacement[] | null | undefined, catalog: SidebarNode[] = SIDEBAR_FOLDERS): SidebarNode[] {
  if (!saved || saved.length === 0) return catalog;
  const byKey = indexCatalog(catalog);
  const used = new Set<string>();
  const built = materialize(saved, byKey, used);
  insertMissing(catalog, null, built, used);
  return hoistDocumentControl(built, catalog);
}

export function placementsFromNodes(nodes: SidebarNode[]): SidebarPlacement[] {
  return defaultPlacements(nodes);
}

export function findPlacement(nodes: SidebarPlacement[], key: string): SidebarPlacement | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    const nested = node.children ? findPlacement(node.children, key) : null;
    if (nested) return nested;
  }
  return null;
}

function containsKey(node: SidebarPlacement, key: string): boolean {
  if (node.key === key) return true;
  return (node.children ?? []).some((child) => containsKey(child, key));
}

export function placementParent(nodes: SidebarPlacement[], key: string, parentKey: string | null = null): { parentKey: string | null; index: number; siblings: SidebarPlacement[] } | null {
  const index = nodes.findIndex((node) => node.key === key);
  if (index >= 0) return { parentKey, index, siblings: nodes };
  for (const node of nodes) {
    if (!node.children) continue;
    const found = placementParent(node.children, key, node.key);
    if (found) return found;
  }
  return null;
}

function detach(nodes: SidebarPlacement[], key: string): SidebarPlacement | null {
  const index = nodes.findIndex((node) => node.key === key);
  if (index >= 0) return nodes.splice(index, 1)[0] ?? null;
  for (const node of nodes) {
    if (!node.children) continue;
    const found = detach(node.children, key);
    if (found) return found;
  }
  return null;
}

/**
 * Moves an item under `parentKey` (null = top of the sidebar) at `index`.
 * `index` is the position in that list before the item is removed.
 * Returns null when the move would put a section inside itself.
 */
export function moveSidebarItem(tree: SidebarPlacement[], key: string, parentKey: string | null, index: number): SidebarPlacement[] | null {
  if (parentKey === key) return null;
  const source = findPlacement(tree, key);
  if (!source) return null;
  if (parentKey && containsKey(source, parentKey)) return null;
  const next = structuredClone(tree);
  const from = placementParent(next, key);
  if (!from) return null;
  let destIndex = index;
  if (from.parentKey === parentKey && from.index < destIndex) destIndex -= 1;
  const removed = detach(next, key);
  if (!removed) return null;
  let dest: SidebarPlacement[];
  if (parentKey === null) dest = next;
  else {
    const parent = findPlacement(next, parentKey);
    if (!parent) return null;
    parent.children ??= [];
    dest = parent.children;
  }
  const at = Math.max(0, Math.min(destIndex, dest.length));
  dest.splice(at, 0, removed);
  return next;
}

export function nudgeSidebarItem(tree: SidebarPlacement[], key: string, direction: -1 | 1): SidebarPlacement[] | null {
  const place = placementParent(tree, key);
  if (!place) return null;
  const target = place.index + direction;
  if (target < 0 || target >= place.siblings.length) return tree;
  return moveSidebarItem(tree, key, place.parentKey, direction < 0 ? target : target + 1);
}

export interface SidebarDestination {
  key: string | null;
  label: string;
  depth: number;
}

export function sidebarDestinations(nodes: SidebarNode[], movingKey: string, depth = 0, blocked = new Set<string>()): SidebarDestination[] {
  const moving = findNode(nodes, movingKey);
  if (moving && isFolder(moving)) collectKeys(moving, blocked);
  blocked.add(movingKey);
  const out: SidebarDestination[] = depth === 0 ? [{ key: null, label: "Top of the sidebar", depth: 0 }] : [];
  for (const node of nodes) {
    if (!isFolder(node) || blocked.has(node.key)) continue;
    out.push({ key: node.key, label: node.label, depth });
    out.push(...sidebarDestinations(node.children, movingKey, depth + 1, blocked));
  }
  return out;
}

function findNode(nodes: SidebarNode[], key: string): SidebarNode | null {
  for (const node of nodes) {
    if (node.key === key) return node;
    if (isFolder(node)) {
      const nested = findNode(node.children, key);
      if (nested) return nested;
    }
  }
  return null;
}

function collectKeys(node: SidebarNode, into: Set<string>) {
  into.add(node.key);
  if (isFolder(node)) for (const child of node.children) collectKeys(child, into);
}
