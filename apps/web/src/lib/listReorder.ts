/**
 * Shared drag-reorder for folders, menus, and lists.
 * The top and bottom of a row insert a sibling. Nesting is only the center
 * band, and only when the row is allowed to become a parent.
 */

/** Top fraction of a nestable row that means "insert before". */
export const REORDER_BEFORE_END = 0.4;
/** Bottom fraction starts here. The band between the two is "move inside". */
export const REORDER_AFTER_START = 0.6;

export type DropPosition = "before" | "after" | "inside";

/** `clientY` relative to a row's box. Lists that cannot nest split in half. */
export function dropPosition(clientY: number, top: number, height: number, allowNest: boolean): DropPosition {
  if (!(height > 0)) return allowNest ? "inside" : "before";
  const ratio = (clientY - top) / height;
  if (!allowNest) return ratio < 0.5 ? "before" : "after";
  if (ratio < REORDER_BEFORE_END) return "before";
  if (ratio > REORDER_AFTER_START) return "after";
  return "inside";
}

export function reorderDropClass(position: DropPosition | null | undefined): string {
  if (!position) return "";
  return `aq-drop-${position}`;
}

/**
 * Moves `moving` before or after `target`. `moving` does not have to be in
 * `ids` yet (it is joining this list). Returns null when `target` is absent.
 */
export function reorderIds<T>(ids: readonly T[], moving: T, target: T, position: "before" | "after"): T[] | null {
  if (Object.is(moving, target)) return null;
  const next = ids.filter((id) => !Object.is(id, moving));
  const index = next.findIndex((id) => Object.is(id, target));
  if (index < 0) return null;
  next.splice(position === "before" ? index : index + 1, 0, moving);
  return next;
}
