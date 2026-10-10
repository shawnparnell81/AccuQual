/** True when an overflow value would give a pane its own scrollbar. */
export function paneOverflowScrolls(overflow: string): boolean {
  const value = overflow.trim().toLowerCase();
  return value === "auto" || value === "scroll" || value === "overlay";
}

/**
 * The tree sticks under the toolbar only when the whole tree fits in the
 * space left below that toolbar. A taller tree scrolls with the page so
 * its bottom stays reachable.
 */
export function treeShouldStick(contentHeight: number, viewportHeight: number, stickyTop: number): boolean {
  if (!(contentHeight > 0) || !(viewportHeight > 0)) return false;
  const room = viewportHeight - Math.max(0, stickyTop);
  return room > 0 && contentHeight <= room + 1;
}
