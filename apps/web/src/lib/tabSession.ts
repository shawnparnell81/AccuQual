import { normalizeTabPath } from "./tabPaths";

/**
 * Workspace tabs follow the URL. Closing one used to lose: the address bar
 * was still that page (or a neighbor sent the router back there), the route
 * effect created the tab again, and that write survived a refresh.
 * A closed path stays closed until the user opens it on purpose.
 */

export interface SessionTab {
  id: string;
  path: string;
  title: string;
  icon: string;
  pinned?: boolean;
}

export interface TabSession {
  tabs: SessionTab[];
  activeId: string | null;
  /** Normalized paths that route sync must not recreate. */
  suppressedPaths: string[];
}

export const UNSAVED_TAB_TITLE = "Unsaved changes";

export function tabIdentity(path: string): string {
  return normalizeTabPath(path);
}

/** The path saved on a tab: normalized pathname, plus a query when the opener passed one. */
export function tabStoredPath(path: string): string {
  const pathname = normalizeTabPath(path);
  const queryIndex = path.indexOf("?");
  if (queryIndex < 0) return pathname;
  const search = path.slice(queryIndex).split("#")[0] ?? "";
  return search.length > 1 ? `${pathname}${search}` : pathname;
}

export function unsavedTabMessage(label: string): string {
  return `Changes have not been saved on: ${label}. Do you want to continue without saving?`;
}

/** One close can ask once. A second click while the dialog is up does not open another. */
let closePromptOpen = false;

export function claimTabClosePrompt(): boolean {
  if (closePromptOpen) return false;
  closePromptOpen = true;
  return true;
}

export function releaseTabClosePrompt(): void {
  closePromptOpen = false;
}

/**
 * A click that is not the tab's own X. The next route sync may reopen a
 * closed path; a redirect or a refresh may not.
 */
let userGesture = false;

export function noteTabUserGesture(): void {
  userGesture = true;
}

export function consumeTabUserGesture(): boolean {
  const value = userGesture;
  userGesture = false;
  return value;
}

export function resetTabSessionGuards(): void {
  closePromptOpen = false;
  userGesture = false;
}

export function resolveTabClose(dirty: boolean, choice: "discard" | "cancel" | null): "ask" | "close" | "stay" {
  if (!dirty) return "close";
  if (choice == null) return "ask";
  if (choice === "cancel") return "stay";
  return "close";
}

const SUPPRESSED_LIMIT = 40;

function uniqueIdentities(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const next: string[] = [];
  for (const path of paths) {
    if (typeof path !== "string" || path === "") continue;
    const key = tabIdentity(path);
    if (seen.has(key)) continue;
    seen.add(key);
    next.push(key);
  }
  return next.slice(-SUPPRESSED_LIMIT);
}

function withoutSuppressed(paths: readonly string[], path: string): string[] {
  const key = tabIdentity(path);
  return paths.filter((entry) => entry !== key);
}

export function restoreSession(tabs: SessionTab[], activeId: string | null, suppressedPaths: readonly string[] | null | undefined): TabSession {
  const suppressed = uniqueIdentities(suppressedPaths ?? []);
  const kept: SessionTab[] = [];
  for (const tab of tabs) {
    if (!tab || typeof tab.path !== "string" || typeof tab.id !== "string") continue;
    const key = tabIdentity(tab.path);
    if (suppressed.includes(key)) continue;
    const stored = tabStoredPath(tab.path);
    const duplicate = kept.findIndex((row) => tabStoredPath(row.path) === stored);
    if (duplicate >= 0) {
      if (tab.id === activeId) kept[duplicate] = { ...tab, path: stored };
      continue;
    }
    kept.push({ ...tab, path: stored });
  }
  const active = kept.some((tab) => tab.id === activeId) ? activeId : (kept[0]?.id ?? null);
  return { tabs: kept, activeId: active, suppressedPaths: suppressed };
}

export function closeSessionTab(session: TabSession, id: string): { session: TabSession; navigateTo: string | null } {
  const index = session.tabs.findIndex((tab) => tab.id === id);
  if (index < 0) {
    const current = session.tabs.find((tab) => tab.id === session.activeId);
    return { session, navigateTo: current?.path ?? null };
  }
  const closed = session.tabs[index]!;
  const tabs = session.tabs.filter((tab) => tab.id !== id);
  let activeId = session.activeId;
  let navigateTo: string | null = null;
  if (session.activeId === id) {
    const neighbor = tabs[index - 1] ?? tabs[index] ?? null;
    activeId = neighbor?.id ?? null;
    navigateTo = neighbor?.path ?? null;
  }
  return {
    session: {
      tabs,
      activeId,
      suppressedPaths: uniqueIdentities([...session.suppressedPaths, closed.path]),
    },
    navigateTo,
  };
}

/**
 * Apply the address bar to the strip.
 * `reopen` is true only for an explicit open or a real user click.
 * Otherwise a suppressed path is left closed and `redirectTo` is the
 * neighbor the strip is actually showing.
 */
export function syncSessionLocation(
  session: TabSession,
  path: string,
  meta: { title: string; icon: string },
  createId: () => string,
  reopen: boolean,
): { session: TabSession; redirectTo: string | null } {
  const key = tabIdentity(path);
  const stored = tabStoredPath(path);
  const active = session.tabs.find((tab) => tab.id === session.activeId) ?? null;
  // The router reports the pathname alone. A filtered list tab keeps its query.
  if (active && stored === key && tabIdentity(active.path) === key && active.path.startsWith(`${key}?`)) {
    return { session, redirectTo: null };
  }

  const existing = session.tabs.find((tab) => tabStoredPath(tab.path) === stored);
  if (existing) {
    const suppressedPaths = withoutSuppressed(session.suppressedPaths, key);
    if (existing.id === session.activeId && suppressedPaths.length === session.suppressedPaths.length) {
      return { session, redirectTo: null };
    }
    return {
      session: { ...session, activeId: existing.id, suppressedPaths },
      redirectTo: null,
    };
  }

  const suppressed = session.suppressedPaths.includes(key);
  if (suppressed && !reopen) {
    const fallback = active ?? session.tabs[0] ?? null;
    const redirectTo = fallback && tabIdentity(fallback.path) !== key ? fallback.path : null;
    return { session, redirectTo };
  }

  const created: SessionTab = { id: createId(), path: stored, title: meta.title, icon: meta.icon };
  return {
    session: {
      tabs: [...session.tabs, created],
      activeId: created.id,
      suppressedPaths: withoutSuppressed(session.suppressedPaths, key),
    },
    redirectTo: null,
  };
}
