import { reorderIds } from "./listReorder";

export interface FolderNode {
  id: number;
  parentId: number | null;
}

export interface OrderedNode extends FolderNode {
  sortOrder: number;
}

/** A row after a drop. `parentId` is the parent it should have once the drop is saved. */
export interface NodePlacement {
  id: number;
  parentId: number | null;
  sortOrder: number;
}

/** True when `targetParentId` is the folder itself or one of its descendants. Null is the top level. */
export function folderMoveIsBlocked(folders: FolderNode[], folderId: number, targetParentId: number | null): boolean {
  if (targetParentId === null) return false;
  if (targetParentId === folderId) return true;
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  if (!byId.has(targetParentId) || !byId.has(folderId)) return true;
  let cursor: number | null = targetParentId;
  const seen = new Set<number>();
  while (cursor !== null) {
    if (cursor === folderId) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = byId.get(cursor)?.parentId ?? null;
  }
  return false;
}

export function nextSortOrder(folders: { parentId: number | null; sortOrder: number; id: number }[], parentId: number | null, movingId: number): number {
  const siblings = folders.filter((folder) => folder.parentId === parentId && folder.id !== movingId);
  return siblings.reduce((max, folder) => Math.max(max, folder.sortOrder), -1) + 1;
}

/**
 * Puts `movingId` inside `targetParentId`, after the children already there.
 * An empty list means it is already there. Null means the move would cycle.
 */
export function planNest(nodes: OrderedNode[], movingId: number, targetParentId: number | null): NodePlacement[] | null {
  if (folderMoveIsBlocked(nodes, movingId, targetParentId)) return null;
  const moving = nodes.find((node) => node.id === movingId);
  if (!moving) return null;
  if (moving.parentId === targetParentId) return [];
  return [{ id: movingId, parentId: targetParentId, sortOrder: nextSortOrder(nodes, targetParentId, movingId) }];
}

/**
 * Inserts `movingId` before or after `targetId` and renumbers that sibling
 * group from 0. `parentId` is the parent's id for the whole group (the
 * target's parent), so a drop beside a row does not nest into it.
 * An empty list means the order did not change. Null means `targetId` is not in the group.
 */
/**
 * Inserts `movingId` in the gap under `parentId`, before or after `targetId`.
 * `targetId` null uses the first sibling for "before" and the last for "after".
 * The row beside the gap does not become the parent.
 */
export function planSiblingGap(
  nodes: OrderedNode[],
  movingId: number,
  parentId: number | null,
  targetId: number | null,
  position: "before" | "after",
  inGroup: (node: OrderedNode) => boolean,
): NodePlacement[] | null {
  if (folderMoveIsBlocked(nodes, movingId, parentId)) return null;
  const moving = nodes.find((node) => node.id === movingId);
  if (!moving || !inGroup(moving)) return null;
  const group = nodes.filter((node) => node.parentId === parentId && inGroup(node)).sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const others = group.filter((node) => node.id !== movingId);
  const anchor = targetId == null ? others.at(position === "before" ? 0 : -1) : group.find((node) => node.id === targetId);
  if (!anchor || anchor.id === movingId) {
    if (targetId == null && others.length === 0) return moving.parentId === parentId ? [] : planNest(nodes, movingId, parentId);
    return anchor?.id === movingId ? [] : null;
  }
  return planSiblingReorder(group, movingId, anchor.id, position, parentId);
}

export function planSiblingReorder(group: OrderedNode[], movingId: number, targetId: number, position: "before" | "after", parentId: number | null): NodePlacement[] | null {
  const ids = reorderIds(
    group.map((node) => node.id),
    movingId,
    targetId,
    position,
  );
  if (!ids) return null;
  const byId = new Map(group.map((node) => [node.id, node]));
  const placements: NodePlacement[] = [];
  ids.forEach((id, sortOrder) => {
    const current = byId.get(id);
    const nextParent = id === movingId ? parentId : (current?.parentId ?? parentId);
    const parentChanged = !current || current.parentId !== nextParent;
    const orderChanged = !current || current.sortOrder !== sortOrder;
    if (!parentChanged && !orderChanged) return;
    placements.push({ id, parentId: nextParent, sortOrder });
  });
  return placements;
}
