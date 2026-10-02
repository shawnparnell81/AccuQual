/** Saved width of the left nav panel. Labels and routes are unchanged. */

export const SIDEBAR_WIDTH_KEY = "accuqual-sidebar-width";

/** Matches the stylesheet default `--side-w`. */
export const SIDEBAR_WIDTH_DEFAULT = 252;

/** Narrowest panel that still shows an icon and the start of a title. */
export const SIDEBAR_WIDTH_MIN = 220;

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
