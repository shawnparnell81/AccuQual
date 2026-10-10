/** How long a pointer can leave the menu, or rest on another row, before a submenu closes. */
export const MENU_HOVER_INTENT_MS = 300;

/** Movement past this counts as still traveling toward a submenu, so the switch waits. */
export const MENU_TRAVEL_PX = 3;

export interface HoverPoint {
  x: number;
  y: number;
}

export interface HoverRect {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

function sign(point: HoverPoint, a: HoverPoint, b: HoverPoint): number {
  return (point.x - b.x) * (a.y - b.y) - (a.x - b.x) * (point.y - b.y);
}

/** Inclusive: a point on an edge counts as inside. */
export function pointInTriangle(point: HoverPoint, a: HoverPoint, b: HoverPoint, c: HoverPoint): boolean {
  const d1 = sign(point, a, b);
  const d2 = sign(point, b, c);
  const d3 = sign(point, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function insideRect(point: HoverPoint, rect: HoverRect): boolean {
  return point.x >= rect.left && point.x <= rect.right && point.y >= rect.top && point.y <= rect.bottom;
}

/**
 * True while the pointer is over the open submenu, or inside the triangle from
 * the parent row to the submenu edge that faces the parent. That is the
 * diagonal path into the submenu. `side` is where the submenu opened:
 * "right" faces the parent along its left edge, "left" along its right edge.
 */
export function movingTowardSubmenu(point: HoverPoint, origin: HoverPoint, submenu: HoverRect, side: "left" | "right"): boolean {
  if (insideRect(point, submenu)) return true;
  const edgeX = side === "right" ? submenu.left : submenu.right;
  const pad = 8;
  return pointInTriangle(point, origin, { x: edgeX, y: submenu.top - pad }, { x: edgeX, y: submenu.bottom + pad });
}

/** Keep the open submenu when the pointer is still moving along the safe triangle. */
export function keepSubmenuWhileTraveling(towardSubmenu: boolean, pointerMoved: number): boolean {
  return towardSubmenu && pointerMoved > MENU_TRAVEL_PX;
}
