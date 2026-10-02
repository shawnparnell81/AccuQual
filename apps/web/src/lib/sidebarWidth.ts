/** Saved width of the left nav panel. Labels and routes are unchanged. */

export const SIDEBAR_WIDTH_KEY = "accuqual-sidebar-width";

/** Matches the stylesheet default `--side-w`. */
export const SIDEBAR_WIDTH_DEFAULT = 252;

/** Narrowest panel that still shows an icon and the start of a title. */
export const SIDEBAR_WIDTH_MIN = 200;

/**
 * Space around a nav label: sidebar padding, nested indent, icon, gap,
 * and the chevron. Used to turn a measured label into a panel width.
 */
export const SIDEBAR_LABEL_CHROME = 168;

/**
 * Widest panel. Keeps the page usable and fits the longest nav title
 * beside the drag grip, icon, and chevron.
 */
export const SIDEBAR_WIDTH_MAX = 480;

/** Icon-only rail used by the collapse control. */
export const SIDEBAR_RAIL_WIDTH = 72;

/** Leave at least this much of the viewport for the page. */
export const SIDEBAR_CONTENT_RESERVE = 420;

/** At this width and below, the nav is an overlay and the saved width stays unused. */
export const SIDEBAR_NARROW_BREAKPOINT = 900;

export interface SidebarWidthStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function maxSidebarWidth(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth)) return SIDEBAR_WIDTH_MAX;
  const room = Math.floor(viewportWidth - SIDEBAR_CONTENT_RESERVE);
  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, room));
}

export function clampSidebarWidth(value: number, viewportWidth = 1600): number {
  const max = maxSidebarWidth(viewportWidth);
  if (!Number.isFinite(value)) return Math.min(SIDEBAR_WIDTH_DEFAULT, max);
  return Math.min(max, Math.max(SIDEBAR_WIDTH_MIN, Math.round(value)));
}

export function readSidebarWidth(storage: SidebarWidthStorage | null | undefined): number {
  try {
    const raw = storage?.getItem(SIDEBAR_WIDTH_KEY);
    if (raw == null || raw.trim() === "") return SIDEBAR_WIDTH_DEFAULT;
    return clampSidebarWidth(Number(raw));
  } catch {
    return SIDEBAR_WIDTH_DEFAULT;
  }
}

export function writeSidebarWidth(storage: SidebarWidthStorage | null | undefined, width: number): void {
  try {
    storage?.setItem(SIDEBAR_WIDTH_KEY, String(clampSidebarWidth(width)));
  } catch {
    // Preference only — the width still applies for this session.
  }
}

/**
 * Pixel width to set on the document, or null when the stylesheet should
 * keep control (icon rail, or the narrow-screen overlay).
 */
export function appliedSidebarWidth(stored: number, viewportWidth: number, collapsed: boolean): number | null {
  if (collapsed || viewportWidth <= SIDEBAR_NARROW_BREAKPOINT) return null;
  return clampSidebarWidth(stored, viewportWidth);
}

export interface SidebarDragResult {
  width: number;
  collapsed: boolean;
}

/**
 * `startWidth` is the panel's current on-screen width (the rail when collapsed).
 * Dragging the rail past the minimum leaves icon mode and becomes a real panel.
 * Dragging an open panel never snaps into the rail; the collapse button does that.
 */
export function widthAfterDrag(startWidth: number, deltaX: number, viewportWidth: number, collapsed: boolean): SidebarDragResult {
  const raw = startWidth + deltaX;
  if (collapsed && (!Number.isFinite(raw) || raw < SIDEBAR_WIDTH_MIN)) {
    return { width: SIDEBAR_RAIL_WIDTH, collapsed: true };
  }
  return { width: clampSidebarWidth(raw, viewportWidth), collapsed: false };
}

/** Inter medium at the nav's size. Wide enough that a fit width does not clip. */
export function estimateLabelPx(label: string): number {
  return Math.ceil(label.trim().length * 7.7);
}

/** Panel width that clears the longest label, never narrower than the default. */
export function sidebarFitWidth(labels: string[], viewportWidth: number, chrome = SIDEBAR_LABEL_CHROME): number {
  const widest = labels.reduce((max, label) => Math.max(max, estimateLabelPx(label)), 0);
  const needed = widest <= 0 ? SIDEBAR_WIDTH_DEFAULT : Math.max(SIDEBAR_WIDTH_DEFAULT, widest + chrome);
  return clampSidebarWidth(needed, viewportWidth);
}

/**
 * Double-click toggles the compact default and the width that clears labels.
 * A width already sitting on the default expands; any other width returns home.
 */
export function widthAfterDoubleClick(current: number, fit: number): number {
  const safeFit = clampSidebarWidth(Number.isFinite(fit) ? Math.max(fit, SIDEBAR_WIDTH_DEFAULT) : SIDEBAR_WIDTH_DEFAULT);
  if (!Number.isFinite(current) || Math.abs(current - SIDEBAR_WIDTH_DEFAULT) <= 12) return safeFit;
  return SIDEBAR_WIDTH_DEFAULT;
}

/**
 * Pixel width to set on the `<nav>` itself.
 * Null keeps the icon-rail stylesheet in charge.
 * On a narrow window the nav is an overlay, so the saved width still applies
 * to that drawer — the page margin stays put via `appliedSidebarWidth`.
 */
export function sidebarNavPixels(stored: number, viewportWidth: number, collapsed: boolean): number | null {
  if (collapsed && viewportWidth > SIDEBAR_NARROW_BREAKPOINT) return null;
  if (viewportWidth <= SIDEBAR_NARROW_BREAKPOINT) {
    return clampSidebarWidth(stored, SIDEBAR_WIDTH_MAX + SIDEBAR_CONTENT_RESERVE);
  }
  return clampSidebarWidth(stored, viewportWidth);
}

/** Viewport passed into the drag clamp. An overlay drawer may use the full max. */
export function dragViewport(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= SIDEBAR_NARROW_BREAKPOINT) {
    return SIDEBAR_WIDTH_MAX + SIDEBAR_CONTENT_RESERVE;
  }
  return viewportWidth;
}
