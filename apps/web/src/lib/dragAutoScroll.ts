import { paneOverflowScrolls } from "./folderExplorerLayout";

/** How close to a pane edge, in pixels, before a drag starts scrolling. */
export const DRAG_SCROLL_EDGE_PX = 56;
/** Pointer travel just outside the pane that still scrolls that edge. */
export const DRAG_SCROLL_OUTSIDE_PX = 28;
export const DRAG_SCROLL_MAX_PX = 18;

/**
 * Signed scroll step for one axis. Negative moves toward `start`.
 * Zero when the pointer is in the middle of the pane.
 */
export function dragScrollDelta(
  pointer: number,
  start: number,
  end: number,
  edge = DRAG_SCROLL_EDGE_PX,
  outside = DRAG_SCROLL_OUTSIDE_PX,
  maxSpeed = DRAG_SCROLL_MAX_PX,
): number {
  if (!(end > start) || !(edge > 0) || !(maxSpeed > 0)) return 0;
  const intoStart = pointer - start;
  const intoEnd = end - pointer;
  if (intoStart < edge && intoStart > -outside) {
    const closeness = Math.min(edge, edge - intoStart);
    return -Math.max(1, Math.round((closeness / edge) * maxSpeed));
  }
  if (intoEnd < edge && intoEnd > -outside) {
    const closeness = Math.min(edge, edge - intoEnd);
    return Math.max(1, Math.round((closeness / edge) * maxSpeed));
  }
  return 0;
}

export function paneCanScroll(overflowY: string, scrollHeight: number, clientHeight: number): boolean {
  return paneOverflowScrolls(overflowY) && scrollHeight > clientHeight + 1;
}

/** Signed scroll step for a pointer near the top or bottom of the window. */
export function windowEdgeScrollDelta(clientY: number, viewportHeight: number): number {
  return dragScrollDelta(clientY, 0, viewportHeight);
}

function isWindowScroller(scroller: HTMLElement): boolean {
  return scroller === document.scrollingElement || scroller === document.documentElement || scroller === document.body;
}

/** The page scroller above this node, or the document when the window itself scrolls. */
export function findPageScroller(start: HTMLElement | null): HTMLElement {
  let node = start?.parentElement ?? null;
  while (node && node !== document.documentElement) {
    if (paneOverflowScrolls(getComputedStyle(node).overflowY)) return node;
    node = node.parentElement;
  }
  const scrolling = document.scrollingElement;
  return scrolling instanceof HTMLElement ? scrolling : document.documentElement;
}

export function pageScrollerViewport(scroller: HTMLElement): number {
  return isWindowScroller(scroller) ? window.innerHeight : scroller.clientHeight;
}

/** Scroll step for a drag near the top or bottom edge of the page window. */
export function pageEdgeScroll(clientY: number, scroller: HTMLElement): number {
  if (isWindowScroller(scroller)) return windowEdgeScrollDelta(clientY, window.innerHeight);
  const rect = scroller.getBoundingClientRect();
  return dragScrollDelta(clientY, rect.top, rect.bottom);
}

/** Moves the page window. Returns false when that window is already at the edge. */
export function applyPageScroll(scroller: HTMLElement, delta: number): boolean {
  if (delta === 0) return false;
  if (isWindowScroller(scroller)) {
    const before = window.scrollY;
    window.scrollBy(0, delta);
    return window.scrollY !== before;
  }
  const before = scroller.scrollTop;
  scroller.scrollTop += delta;
  return scroller.scrollTop !== before;
}

/** Vertical scroll step for the pane under the pointer. Zero for a pane that does not scroll. */
export function paneScrollDelta(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; right: number; bottom: number },
  overflowY: string,
  scrollHeight: number,
  clientHeight: number,
): number {
  if (!paneCanScroll(overflowY, scrollHeight, clientHeight)) return 0;
  if (clientX < rect.left - 12 || clientX > rect.right + 12) return 0;
  return dragScrollDelta(clientY, rect.top, rect.bottom);
}
