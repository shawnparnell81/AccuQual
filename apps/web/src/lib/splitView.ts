/** Right-pane path stored in the URL hash so a refresh reopens the same split. */

export const SPLIT_HASH_KEY = "split";

export const SPLIT_RATIO_DEFAULT = 0.5;
export const SPLIT_RATIO_MIN = 0.22;
export const SPLIT_RATIO_MAX = 0.78;

export interface SplitTarget {
  open: boolean;
  path: string | null;
}

export interface PaneHref {
  pathname: string;
  search: string;
  hash: string;
}

export function clampSplitRatio(value: number): number {
  if (!Number.isFinite(value)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, value));
}

export function splitHref(path: string): PaneHref {
  const hashAt = path.indexOf("#");
  const hash = hashAt >= 0 ? path.slice(hashAt) : "";
  const before = hashAt >= 0 ? path.slice(0, hashAt) : path;
  const queryAt = before.indexOf("?");
  if (queryAt < 0) return { pathname: before || "/", search: "", hash };
  return { pathname: before.slice(0, queryAt) || "/", search: before.slice(queryAt), hash };
}

export function joinHref(parts: PaneHref): string {
  return `${parts.pathname || "/"}${parts.search}${parts.hash}`;
}

/** A location object for one pane. Its search string is not the other pane's. */
export function paneLocation(path: string): PaneHref {
  const parts = splitHref(path || "/");
  return { pathname: parts.pathname || "/", search: parts.search, hash: parts.hash };
}

function hashParams(hash: string): URLSearchParams {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  return new URLSearchParams(raw);
}

export function readSplit(hash: string): SplitTarget {
  const params = hashParams(hash);
  if (!params.has(SPLIT_HASH_KEY)) return { open: false, path: null };
  const value = params.get(SPLIT_HASH_KEY) ?? "";
  if (value.startsWith("/")) return { open: true, path: value };
  return { open: true, path: null };
}

export function writeSplit(hash: string, open: boolean, path: string | null): string {
  const params = hashParams(hash);
  if (!open) params.delete(SPLIT_HASH_KEY);
  else params.set(SPLIT_HASH_KEY, path && path.startsWith("/") ? path : "");
  const next = params.toString();
  return next ? `#${next}` : "";
}

export function locationPath(pathname: string, search: string): string {
  return `${pathname || "/"}${search || ""}`;
}

/**
 * Resolve a react-router target against the pane's own path.
 * Search-only targets keep the pane pathname and do not touch the other pane.
 */
export function resolvePaneTarget(currentPath: string, to: string | { pathname?: string; search?: string; hash?: string }): string {
  const current = splitHref(currentPath || "/");
  const base = new URL(`${current.pathname}${current.search}`, "http://accuqual.local");
  if (typeof to === "string") {
    if (to === "") return `${base.pathname}${base.search}`;
    const next = new URL(to, base);
    return `${next.pathname}${next.search}${next.hash}`;
  }
  const pathname = to.pathname && to.pathname !== "" ? to.pathname : base.pathname;
  const next = new URL(pathname, base);
  if (to.pathname == null) next.pathname = base.pathname;
  let search = "";
  if (to.search != null) search = to.search === "" ? "" : to.search.startsWith("?") ? to.search : `?${to.search}`;
  else if (to.pathname == null) search = base.search;
  else search = next.search;
  const hash = to.hash ?? "";
  return `${next.pathname}${search}${hash}`;
}

export function swapPanePaths(leftPath: string, rightPath: string | null): { left: string; right: string } {
  const right = rightPath && rightPath.startsWith("/") ? rightPath : leftPath;
  return { left: right, right: leftPath.startsWith("/") ? leftPath : `/${leftPath}` };
}
