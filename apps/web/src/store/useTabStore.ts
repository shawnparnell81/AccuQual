import { create } from "zustand";
import { isLiveTabPath, selectRestoredTabs } from "../lib/tabPaths";
import { moveTab, setTabPinned, withPinsLeft } from "../lib/tabLayout";
import { dedupeWorkspaceTabs, followWorkspacePath } from "../lib/workspaceTab";

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
   */
  syncActiveTabLocation: (path: string, title: string, icon: string) => void;
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

function persist(ownerId: string | null, tabs: TabInstance[], activeId: string | null) {
  if (!ownerId) return;
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify({ tabs, activeId }));
  } catch {
    // localStorage unavailable (private mode, quota, ...) — tabs just won't survive a refresh.
  }
}

function restore(ownerId: string): { tabs: TabInstance[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(storageKey(ownerId));
    if (!raw) return { tabs: [], activeId: null };
    const parsed = JSON.parse(raw) as { tabs: TabInstance[]; activeId: string | null };
    const selected = selectRestoredTabs(parsed.tabs ?? [], parsed.activeId ?? null);
    return dedupeWorkspaceTabs(selected.tabs, selected.activeId);
  } catch {
    return { tabs: [], activeId: null };
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

  loadForUser: (ownerId) => {
    const restored = restore(ownerId);
    const tabs = withPinsLeft(restored.tabs);
    const activeId = restored.activeId;
    set({ ownerId, tabs, activeId });
    // Write the filtered list back so a removed page (ERP, requisitions, …) is not opened again next time.
    persist(ownerId, tabs, activeId);
  },

  clear: () => set({ ownerId: null, tabs: [], activeId: null }),

  openTab: ({ path, title, icon }) => {
    if (!isLiveTabPath(path)) return get().activeId ?? "";
    const { ownerId, tabs, activeId } = get();
    const result = followWorkspacePath(tabs, activeId, { path, title, icon }, newTabId);
    const nextTabs = withPinsLeft(result.tabs);
    persist(ownerId, nextTabs, result.activeId);
    set({ tabs: nextTabs, activeId: result.activeId });
    return result.activeId;
  },

  syncActiveTabLocation: (path, title, icon) => {
    if (!isLiveTabPath(path)) return;
    const { ownerId, tabs, activeId } = get();
    const result = followWorkspacePath(tabs, activeId, { path, title, icon }, newTabId);
    if (result.tabs === tabs && result.activeId === activeId) return;
    const nextTabs = withPinsLeft(result.tabs);
    persist(ownerId, nextTabs, result.activeId);
    set({ tabs: nextTabs, activeId: result.activeId });
  },

  activateTab: (id) => {
    const { ownerId, tabs } = get();
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return null;
    persist(ownerId, tabs, id);
    set({ activeId: id });
    return tab.path;
  },

  closeTab: (id) => {
    const { ownerId, tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return activeId ? (tabs.find((t) => t.id === activeId)?.path ?? null) : null;

    const nextTabs = tabs.filter((t) => t.id !== id);
    let nextActiveId = activeId;
    if (activeId === id) {
      const neighbor = nextTabs[idx - 1] ?? nextTabs[idx] ?? null;
      nextActiveId = neighbor?.id ?? null;
    }
    persist(ownerId, nextTabs, nextActiveId);
    set({ tabs: nextTabs, activeId: nextActiveId });
    return nextTabs.find((t) => t.id === nextActiveId)?.path ?? null;
  },

  reorderTabs: (fromId, toId) => {
    const { ownerId, tabs, activeId } = get();
    const nextTabs = moveTab(tabs, fromId, toId);
    persist(ownerId, nextTabs, activeId);
    set({ tabs: nextTabs });
  },

  togglePin: (id) => {
    const { ownerId, tabs, activeId } = get();
    const current = tabs.find((tab) => tab.id === id);
    if (!current) return;
    const nextTabs = setTabPinned(tabs, id, !current.pinned);
    persist(ownerId, nextTabs, activeId);
    set({ tabs: nextTabs });
  },
}));
