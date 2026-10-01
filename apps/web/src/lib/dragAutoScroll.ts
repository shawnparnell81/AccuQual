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
  return (overflowY === "auto" || overflowY === "scroll") && scrollHeight > clientHeight + 1;
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
