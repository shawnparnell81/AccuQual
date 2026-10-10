import { create } from "zustand";
import { isLiveTabPath, selectRestoredTabs } from "../lib/tabPaths";
import { moveTab, setTabPinned, withPinsLeft } from "../lib/tabLayout";
import {
  closeSessionTab,
  consumeTabUserGesture,
  restoreSession,
  syncSessionLocation,
  type TabSession,
} from "../lib/tabSession";

export interface TabInstance {
  id: string;
  path: string;
  title: string;
  /** A short key into TabBar.tsx's icon lookup — kept as a plain string (not a component) so a tab survives round-tripping through localStorage. */
  icon: string;
  /** Pinned tabs stay on the left and survive a refresh with the rest of the strip. */
  pinned?: boolean;
}

interface TabState {
  ownerId: string | null;
  tabs: TabInstance[];
  activeId: string | null;
  /** Closed paths the address bar must not recreate until the user opens them. */
  suppressedPaths: string[];
  /** Called once on login/app load — restores only this company's own tabs, same isolation guarantee as the existing window-manager (useWindowStore). */
  loadForUser: (ownerId: string) => void;
  /** Called on logout — tab leakage must be impossible. */
  clear: () => void;
  /**
   * The one real "new tab" entry point (global search results, an explicit
   * "open in new tab" action) — everything else navigates in place via
   * syncActiveTabLocation. Reuses an existing tab for the same path instead
   * of stacking a duplicate, same convention as useWindowStore.openWindow.
   */
  openTab: (tab: { path: string; title: string; icon: string }) => string;
  /**
   * Called on every route change from AppLayout's location effect —
   * find-or-create a tab for this path and make it active, same as
   * openTab. Every distinct page the user visits keeps its own tab instead
   * of overwriting whatever was active (that was the entire "can't see
   * multiple pages open at once" bug: normal navigation used to just
   * rename the current tab in place, and only global search's explicit
   * openTab call ever produced a second one). A no-op when the active tab
   * already shows this path (e.g. right after openTab's own navigate()
   * lands here). Returns a path when this URL is a page the user just
   * closed, so the caller can replace it with the neighbor instead of
   * recreating the tab.
   */
  syncActiveTabLocation: (path: string, title: string, icon: string) => string | null;
  /** Sets the active tab and returns its path so the caller can navigate() to it. */
  activateTab: (id: string) => string | null;
  /** Removes a tab; if it was active, returns the new active tab's path (or null if none remain) so the caller can navigate there. */
  closeTab: (id: string) => string | null;
  /** Drag-and-drop reorder. Pinned tabs are gathered back to the left. */
  reorderTabs: (fromId: string, toId: string) => void;
  togglePin: (id: string) => void;
}

function storageKey(ownerId: string) {
  return `accuqual_tabs_${ownerId}`;
}

function persist(ownerId: string | null, session: TabSession) {
  if (!ownerId) return;
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify({
      tabs: session.tabs,
      activeId: session.activeId,
      suppressedPaths: session.suppressedPaths,
    }));
  } catch {
    // localStorage unavailable (private mode, quota, ...) — tabs just won't survive a refresh.
  }
}

function sessionOf(state: { tabs: TabInstance[]; activeId: string | null; suppressedPaths: string[] }): TabSession {
  return { tabs: state.tabs, activeId: state.activeId, suppressedPaths: state.suppressedPaths };
}

function restore(ownerId: string): TabSession {
  try {
    const raw = localStorage.getItem(storageKey(ownerId));
    if (!raw) return { tabs: [], activeId: null, suppressedPaths: [] };
    const parsed = JSON.parse(raw) as { tabs?: TabInstance[]; activeId?: string | null; suppressedPaths?: string[] };
    const selected = selectRestoredTabs(parsed.tabs ?? [], parsed.activeId ?? null);
    return restoreSession(selected.tabs, selected.activeId, parsed.suppressedPaths);
  } catch {
    return { tabs: [], activeId: null, suppressedPaths: [] };
  }
}

let tabCounter = 0;
function newTabId() {
  return `tab-${Date.now()}-${++tabCounter}`;
}

export const useTabStore = create<TabState>((set, get) => ({
  ownerId: null,
  tabs: [],
  activeId: null,
  suppressedPaths: [],

  loadForUser: (ownerId) => {
    const restored = restore(ownerId);
    const tabs = withPinsLeft(restored.tabs);
    const activeId = restored.activeId;
    const suppressedPaths = restored.suppressedPaths;
    set({ ownerId, tabs, activeId, suppressedPaths });
    // Write the filtered list back so a removed page (ERP, requisitions, …) is not opened again next time.
    persist(ownerId, { tabs, activeId, suppressedPaths });
  },

  clear: () => set({ ownerId: null, tabs: [], activeId: null, suppressedPaths: [] }),

  openTab: ({ path, title, icon }) => {
    if (!isLiveTabPath(path)) return get().activeId ?? "";
    const state = get();
    const result = syncSessionLocation(sessionOf(state), path, { title, icon }, newTabId, true);
    const tabs = withPinsLeft(result.session.tabs);
    persist(state.ownerId, { ...result.session, tabs });
    set({ tabs, activeId: result.session.activeId, suppressedPaths: result.session.suppressedPaths });
    return result.session.activeId ?? "";
  },

  syncActiveTabLocation: (path, title, icon) => {
    const reopen = consumeTabUserGesture();
    if (!isLiveTabPath(path)) return null;
    const state = get();
    const current = sessionOf(state);
    const result = syncSessionLocation(current, path, { title, icon }, newTabId, reopen);
    if (result.session !== current) {
      const tabs = withPinsLeft(result.session.tabs);
      persist(state.ownerId, { ...result.session, tabs });
      set({ tabs, activeId: result.session.activeId, suppressedPaths: result.session.suppressedPaths });
    }
    return result.redirectTo;
  },

  activateTab: (id) => {
    const state = get();
    const tab = state.tabs.find((t) => t.id === id);
    if (!tab) return null;
    persist(state.ownerId, { ...sessionOf(state), activeId: id });
    set({ activeId: id });
    return tab.path;
  },

  closeTab: (id) => {
    const state = get();
    const result = closeSessionTab(sessionOf(state), id);
    const tabs = withPinsLeft(result.session.tabs);
    persist(state.ownerId, { ...result.session, tabs });
    set({ tabs, activeId: result.session.activeId, suppressedPaths: result.session.suppressedPaths });
    return result.navigateTo;
  },

  reorderTabs: (fromId, toId) => {
    const state = get();
    const tabs = moveTab(state.tabs, fromId, toId);
    persist(state.ownerId, { ...sessionOf(state), tabs });
    set({ tabs });
  },

  togglePin: (id) => {
    const state = get();
    const current = state.tabs.find((tab) => tab.id === id);
    if (!current) return;
    const tabs = setTabPinned(state.tabs, id, !current.pinned);
    persist(state.ownerId, { ...sessionOf(state), tabs });
    set({ tabs });
  },
}));
