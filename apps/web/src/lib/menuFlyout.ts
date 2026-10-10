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
}

/**
 * Puts a submenu beside its row and keeps the whole panel inside the viewport.
 * It opens to the right. When that would run past the window, it opens to the left.
 * When the panel is taller than the space below the row, it shifts up.
 */
export function placeMenuFlyout(anchor: MenuRect, size: { width: number; height: number }, viewport: { width: number; height: number }, margin = 8): MenuPoint {
  let left = anchor.right - 4;
  if (left + size.width > viewport.width - margin) left = anchor.left - size.width + 4;
  if (left < margin) left = margin;
  if (left + size.width > viewport.width - margin) left = Math.max(margin, viewport.width - margin - size.width);

  let top = anchor.top;
  if (top + size.height > viewport.height - margin) top = viewport.height - margin - size.height;
  if (top < margin) top = margin;
  return { top, left };
}
