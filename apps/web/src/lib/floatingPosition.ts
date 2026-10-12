/** Draggable floating button: position math and per-user storage. No DOM access except localStorage. */

export interface FloatPoint {
  x: number;
  y: number;
}

/** Pointer travel (px) that turns a press into a drag. A shorter press is a click. */
export const DRAG_THRESHOLD_PX = 5;
/** Keeps the button this far from the viewport edge. */
export const EDGE_MARGIN_PX = 8;

export function fabStorageKey(userId: number | string | null | undefined): string {
  return `accuqual.aiFab.position.${userId ?? "anon"}`;
}

/** Keeps a top-left point so the whole button stays inside the viewport. */
export function clampToViewport(point: FloatPoint, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = EDGE_MARGIN_PX): FloatPoint {
  const maxX = Math.max(margin, viewport.width - size.width - margin);
  const maxY = Math.max(margin, viewport.height - size.height - margin);
  return {
    x: Math.round(Math.min(Math.max(point.x, margin), maxX)),
    y: Math.round(Math.min(Math.max(point.y, margin), maxY)),
  };
}

export function movedPastThreshold(start: FloatPoint, now: FloatPoint, threshold = DRAG_THRESHOLD_PX): boolean {
  return Math.hypot(now.x - start.x, now.y - start.y) > threshold;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function loadFabPosition(key: string, store: StorageLike | null = storage()): FloatPoint | null {
  try {
    const raw = store?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<FloatPoint>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number" || !Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

export function saveFabPosition(key: string, point: FloatPoint | null, store: StorageLike | null = storage()): void {
  try {
    if (point) store?.setItem(key, JSON.stringify(point));
    else store?.removeItem(key);
  } catch {
    // Storage can be blocked. The button still works at its default spot.
  }
}
