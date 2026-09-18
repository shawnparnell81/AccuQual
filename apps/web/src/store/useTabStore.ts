import { create } from "zustand";

export interface TabInstance {
  id: string;
  path: string;
  title: string;
  /** A short key into TabBar.tsx's icon lookup — kept as a plain string (not a component) so a tab survives round-tripping through localStorage. */
  icon: string;
}

interface TabState {
  tenantId: string | null;
  tabs: TabInstance[];
  activeId: string | null;
  /** Called once on login/app load — restores only this tenant's own tabs, same isolation guarantee as the existing window-manager (useWindowStore). */
  loadForTenant: (tenantId: string) => void;
  /** Called on logout — cross-tenant tab leakage must be impossible. */
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
   * lands here).
   */
  syncActiveTabLocation: (path: string, title: string, icon: string) => void;
  /** Sets the active tab and returns its path so the caller can navigate() to it. */
  activateTab: (id: string) => string | null;
  /** Removes a tab; if it was active, returns the new active tab's path (or null if none remain) so the caller can navigate there. */
  closeTab: (id: string) => string | null;
}

function storageKey(tenantId: string) {
  return `accuqual_tabs_${tenantId}`;
}

function persist(tenantId: string | null, tabs: TabInstance[], activeId: string | null) {
  if (!tenantId) return;
  try {
    localStorage.setItem(storageKey(tenantId), JSON.stringify({ tabs, activeId }));
  } catch {
    // localStorage unavailable (private mode, quota, ...) — tabs just won't survive a refresh.
  }
}

function restore(tenantId: string): { tabs: TabInstance[]; activeId: string | null } {
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    if (!raw) return { tabs: [], activeId: null };
    const parsed = JSON.parse(raw) as { tabs: TabInstance[]; activeId: string | null };
    return { tabs: parsed.tabs ?? [], activeId: parsed.activeId ?? null };
  } catch {
    return { tabs: [], activeId: null };
  }
}

let tabCounter = 0;
function newTabId() {
  return `tab-${Date.now()}-${++tabCounter}`;
}

export const useTabStore = create<TabState>((set, get) => ({
  tenantId: null,
  tabs: [],
  activeId: null,

  loadForTenant: (tenantId) => {
    const { tabs, activeId } = restore(tenantId);
    set({ tenantId, tabs, activeId });
  },

  clear: () => set({ tenantId: null, tabs: [], activeId: null }),

  openTab: ({ path, title, icon }) => {
    const { tenantId, tabs } = get();
    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      persist(tenantId, tabs, existing.id);
      set({ activeId: existing.id });
      return existing.id;
    }
    const tab: TabInstance = { id: newTabId(), path, title, icon };
    const nextTabs = [...tabs, tab];
    persist(tenantId, nextTabs, tab.id);
    set({ tabs: nextTabs, activeId: tab.id });
    return tab.id;
  },

  syncActiveTabLocation: (path, title, icon) => {
    const { tenantId, tabs, activeId } = get();
    const active = tabs.find((t) => t.id === activeId);
    if (active?.path === path) return; // already showing this path — e.g. openTab's own navigate() just landed here

    const existing = tabs.find((t) => t.path === path);
    if (existing) {
      persist(tenantId, tabs, existing.id);
      set({ activeId: existing.id });
      return;
    }
    const tab: TabInstance = { id: newTabId(), path, title, icon };
    const nextTabs = [...tabs, tab];
    persist(tenantId, nextTabs, tab.id);
    set({ tabs: nextTabs, activeId: tab.id });
  },

  activateTab: (id) => {
    const { tenantId, tabs } = get();
    const tab = tabs.find((t) => t.id === id);
    if (!tab) return null;
    persist(tenantId, tabs, id);
    set({ activeId: id });
    return tab.path;
  },

  closeTab: (id) => {
    const { tenantId, tabs, activeId } = get();
    const idx = tabs.findIndex((t) => t.id === id);
    if (idx === -1) return activeId ? (tabs.find((t) => t.id === activeId)?.path ?? null) : null;

    const nextTabs = tabs.filter((t) => t.id !== id);
    let nextActiveId = activeId;
    if (activeId === id) {
      const neighbor = nextTabs[idx - 1] ?? nextTabs[idx] ?? null;
      nextActiveId = neighbor?.id ?? null;
    }
    persist(tenantId, nextTabs, nextActiveId);
    set({ tabs: nextTabs, activeId: nextActiveId });
    return nextTabs.find((t) => t.id === nextActiveId)?.path ?? null;
  },
}));
