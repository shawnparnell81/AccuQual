/** A rectangle in viewport coordinates. */
export interface MenuRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
  width: number;
  height: number;
}

export interface MenuPoint {
  top: number;
  left: number;
  /** "right" opens beside the row's right edge. "left" flips beside the left edge. */
  side: "left" | "right";
}

/** How far the flyout overlaps its row so the two boxes share an edge. */
export const FLYOUT_ANCHOR_OVERLAP = 8;

/**
 * Puts a submenu beside its row and keeps the whole panel inside the viewport.
 * It opens to the right and overlaps the row so there is no gap to fall through.
 * When that would run past the window, it opens to the left.
 * When the panel is taller than the space below the row, it shifts up.
 */
export function placeMenuFlyout(anchor: MenuRect, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8): MenuPoint {
  let side: "left" | "right" = "right";
  let left = anchor.right - FLYOUT_ANCHOR_OVERLAP;
  if (left + size.width > viewport.width - margin) {
    side = "left";
    left = anchor.left - size.width + FLYOUT_ANCHOR_OVERLAP;
  }
  if (left < margin) left = margin;
  if (left + size.width > viewport.width - margin) left = Math.max(margin, viewport.width - margin - size.width);
  if (left + size.width <= anchor.left + FLYOUT_ANCHOR_OVERLAP) side = "left";
  else if (left >= anchor.right - FLYOUT_ANCHOR_OVERLAP) side = "right";

  let top = anchor.top;
  if (top + size.height > viewport.height - margin) top = viewport.height - margin - size.height;
  if (top < margin) top = margin;
  return { top, left, side };
}
