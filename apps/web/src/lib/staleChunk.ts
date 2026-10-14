/**
 * After a deploy, a browser that still has the old app open asks for page files that no longer exist, and the page
 * shows "This page couldn't be shown". Reloading once picks up the new app. The guard stops a reload loop when the
 * file is missing for another reason.
 */
const RELOAD_KEY = "aq-stale-chunk-reload";
const GUARD_MS = 60_000;

export function isStaleChunkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /dynamically imported module|Importing a module script failed|error loading dynamically imported|Failed to fetch dynamically|Unable to preload CSS/i.test(message);
}

export function shouldReloadForStaleChunk(error: unknown, lastReloadAt: number | null, now: number): boolean {
  if (!isStaleChunkError(error)) return false;
  return lastReloadAt == null || now - lastReloadAt > GUARD_MS;
}

/** True when it started a reload (the caller should not surface the error). */
export function reloadForStaleChunk(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  let last: number | null = null;
  try {
    const raw = window.sessionStorage.getItem(RELOAD_KEY);
    last = raw ? Number(raw) : null;
  } catch {
    return false;
  }
  const now = Date.now();
  if (!shouldReloadForStaleChunk(error, last, now)) return false;
  try {
    window.sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
