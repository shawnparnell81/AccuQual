import { create } from "zustand";
import { isLiveTabPath, selectRestoredTabs } from "../lib/tabPaths";
import { moveTab, setTabPinned, withPinsLeft } from "../lib/tabLayout";
import {
  closeWorkspaceTab,
  consumeTabUserGesture,
  dedupeWorkspaceTabs,
  dropSuppressedTabs,
  peekTabUserGesture,
  syncClosedWorkspace,
  uniqueSuppressed,
  workspaceTabKey,
} from "../lib/workspaceTab";

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
  /** Section keys the address bar must not recreate until the user opens them. */
  suppressedKeys: string[];
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
   * Called on every route change. A different nav section opens or focuses
   * its own tab. A sub-page of the section already showing rewrites that
   * same tab, including its pin.
   * Returns the neighbor path when this URL is a section the user just
   * closed, so the caller can replace it instead of recreating the tab.
   */
  syncActiveTabLocation: (
    path: string,
    title: string,
    icon: string,
    options?: { pathChanged?: boolean; allowCreate?: boolean },
  ) => string | null;
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

function persist(ownerId: string | null, tabs: TabInstance[], activeId: string | null, suppressedKeys: string[]) {
  if (!ownerId) return;
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify({ tabs, activeId, suppressedKeys }));
  } catch {
    // localStorage unavailable (private mode, quota, ...) — tabs just won't survive a refresh.
  }
}

function restore(ownerId: string): { tabs: TabInstance[]; activeId: string | null; suppressedKeys: string[] } {
  try {
    const raw = localStorage.getItem(storageKey(ownerId));
    if (!raw) return { tabs: [], activeId: null, suppressedKeys: [] };
    const parsed = JSON.parse(raw) as { tabs?: TabInstance[]; activeId?: string | null; suppressedKeys?: string[] };
    const selected = selectRestoredTabs(parsed.tabs ?? [], parsed.activeId ?? null);
    const deduped = dedupeWorkspaceTabs(selected.tabs, selected.activeId ?? null);
    const suppressedKeys = uniqueSuppressed(parsed.suppressedKeys ?? []);
    const dropped = dropSuppressedTabs(deduped.tabs, deduped.activeId, suppressedKeys);
    return { tabs: dropped.tabs, activeId: dropped.activeId, suppressedKeys };
  } catch {
    return { tabs: [], activeId: null, suppressedKeys: [] };
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
  suppressedKeys: [],

  loadForUser: (ownerId) => {
    const restored = restore(ownerId);
    const tabs = withPinsLeft(restored.tabs);
    const activeId = restored.activeId;
    const suppressedKeys = restored.suppressedKeys;
    set({ ownerId, tabs, activeId, suppressedKeys });
    // Write the filtered list back so a removed page (ERP, requisitions, …) is not opened again next time.
    persist(ownerId, tabs, activeId, suppressedKeys);
  },

  clear: () => set({ ownerId: null, tabs: [], activeId: null, suppressedKeys: [] }),

  openTab: ({ path, title, icon }) => {
    if (!isLiveTabPath(path)) return get().activeId ?? "";
    const { ownerId, tabs, activeId, suppressedKeys } = get();
    const result = syncClosedWorkspace(tabs, activeId, suppressedKeys, { path, title, icon }, newTabId, true);
    const nextTabs = withPinsLeft(result.tabs);
    persist(ownerId, nextTabs, result.activeId, result.suppressed);
    set({ tabs: nextTabs, activeId: result.activeId, suppressedKeys: result.suppressed });
    return result.activeId ?? "";
  },

  syncActiveTabLocation: (path, title, icon, options) => {
    const pathChanged = options?.pathChanged ?? true;
    const gesture = peekTabUserGesture();
    const reopen = pathChanged && gesture;
    if (!isLiveTabPath(path)) {
      if (pathChanged) consumeTabUserGesture();
      return null;
    }
    const { ownerId, tabs, activeId, suppressedKeys } = get();
    const blocked = suppressedKeys.includes(workspaceTabKey(path)) && !reopen && !tabs.some((tab) => workspaceTabKey(tab.path) === path);
    if (!blocked && options?.allowCreate === false) return null;
    if (pathChanged || !blocked) consumeTabUserGesture();
    const result = syncClosedWorkspace(tabs, activeId, suppressedKeys, { path, title, icon }, newTabId, reopen);
    if (result.tabs === tabs && result.activeId === activeId && result.suppressed === suppressedKeys) return result.redirectTo;
    const nextTabs = withPinsLeft(result.tabs);
    persist(ownerId, nextTabs, result.activeId, result.suppressed);
    set({ tabs: nextTabs, activeId: result.activeId, suppressedKeys: result.suppressed });
    return result.redirectTo;
  },

  activateTab: (id) => {
    const { ownerId, tabs, suppressedKeys } = get();
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return null;
    persist(ownerId, tabs, id, suppressedKeys);
    set({ activeId: id });
    return tab.path;
  },

  closeTab: (id) => {
    const { ownerId, tabs, activeId, suppressedKeys } = get();
    const result = closeWorkspaceTab(tabs, activeId, suppressedKeys, id);
    const nextTabs = withPinsLeft(result.tabs);
    persist(ownerId, nextTabs, result.activeId, result.suppressed);
    set({ tabs: nextTabs, activeId: result.activeId, suppressedKeys: result.suppressed });
    return result.navigateTo;
  },

  reorderTabs: (fromId, toId) => {
    const { ownerId, tabs, activeId, suppressedKeys } = get();
    const nextTabs = moveTab(tabs, fromId, toId);
    persist(ownerId, nextTabs, activeId, suppressedKeys);
    set({ tabs: nextTabs });
  },

  togglePin: (id) => {
    const { ownerId, tabs, activeId, suppressedKeys } = get();
    const current = tabs.find((tab) => tab.id === id);
    if (!current) return;
    const nextTabs = setTabPinned(tabs, id, !current.pinned);
    persist(ownerId, nextTabs, activeId, suppressedKeys);
    set({ tabs: nextTabs });
  },
}));
