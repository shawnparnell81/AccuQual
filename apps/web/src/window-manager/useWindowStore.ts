import { create } from "zustand";
import type { WindowInstance, WindowType } from "../types/window";

const BASE_Z = 100;

interface WindowState {
  tenantId: string | null;
  windows: WindowInstance[];
  /** Called once on login/app load — restores only this tenant's saved workspace, per the Multi-Tenant Patch Pack. */
  loadForTenant: (tenantId: string) => void;
  /** Called on logout — cross-tenant window leakage must be impossible, so windows never carry over. */
  clear: () => void;
  openWindow: (
    win: { type: WindowType; title: string; entityId?: number; formType?: string; state?: Record<string, unknown> },
    id?: string
  ) => string;
  closeWindow: (id: string) => void;
  focusWindow: (id: string) => void;
  updateRect: (id: string, rect: Partial<Pick<WindowInstance, "x" | "y" | "width" | "height">>) => void;
  minimizeWindow: (id: string) => void;
  toggleMaximize: (id: string) => void;
  updateWindowState: (id: string, state: Record<string, unknown>) => void;
}

function storageKey(tenantId: string) {
  return `accuqual_workspace_${tenantId}`;
}

function persist(tenantId: string | null, windows: WindowInstance[]) {
  if (!tenantId) return;
  try {
    localStorage.setItem(storageKey(tenantId), JSON.stringify(windows));
  } catch {
    // localStorage unavailable (private mode, quota, ...) — workspace just won't survive a refresh.
  }
}

function restore(tenantId: string): WindowInstance[] {
  try {
    const raw = localStorage.getItem(storageKey(tenantId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WindowInstance[];
    // Belt-and-suspenders: a window whose tenantId doesn't match the key it was stored
    // under should never be restorable — this is the "IDs cannot collide across tenants" guarantee.
    return parsed.filter((w) => w.tenantId === tenantId);
  } catch {
    return [];
  }
}

let zCounter = BASE_Z;

export const useWindowStore = create<WindowState>((set, get) => ({
  tenantId: null,
  windows: [],

  loadForTenant: (tenantId) => {
    const windows = restore(tenantId);
    zCounter = BASE_Z + windows.length;
    set({ tenantId, windows });
  },

  // Also removes the persisted workspace, not just the in-memory windows —
  // otherwise the next loadForTenant() (any user logging into this same
  // tenant, including this same user's own next login) reads the stale
  // localStorage entry right back, maximized state and all, silently
  // covering their very first screen with someone's leftover form. Found
  // live (QA sweep review): logging out never actually cleared this.
  clear: () => {
    const { tenantId } = get();
    if (tenantId) {
      try {
        localStorage.removeItem(storageKey(tenantId));
      } catch {
        // localStorage unavailable — nothing persisted to clean up anyway.
      }
    }
    set({ tenantId: null, windows: [] });
  },

  openWindow: (win, id) => {
    const { tenantId, windows } = get();
    if (!tenantId) throw new Error("No tenant context — cannot open a window");

    // Reuse an existing window for the same form/entity instead of stacking duplicates.
    const existing = windows.find(
      (w) => w.type === win.type && w.formType === win.formType && w.entityId === win.entityId
    );
    if (existing) {
      get().focusWindow(existing.id);
      return existing.id;
    }

    const newId = id ?? `${win.type}-${win.formType ?? ""}-${win.entityId ?? ""}-${Date.now()}`;
    const offset = (windows.length % 6) * 24;
    const next: WindowInstance = {
      id: newId,
      tenantId,
      type: win.type,
      entityId: win.entityId,
      formType: win.formType,
      title: win.title,
      x: 80 + offset,
      y: 60 + offset,
      width: 720,
      height: 560,
      zIndex: ++zCounter,
      minimized: false,
      maximized: false,
      state: win.state ?? {},
    };
    const nextWindows = [...windows, next];
    persist(tenantId, nextWindows);
    set({ windows: nextWindows });
    return newId;
  },

  closeWindow: (id) => {
    const { tenantId, windows } = get();
    const nextWindows = windows.filter((w) => w.id !== id);
    persist(tenantId, nextWindows);
    set({ windows: nextWindows });
  },

  focusWindow: (id) => {
    const { tenantId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, zIndex: ++zCounter, minimized: false } : w));
    persist(tenantId, nextWindows);
    set({ windows: nextWindows });
  },

  updateRect: (id, rect) => {
    const { tenantId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, ...rect } : w));
    persist(tenantId, nextWindows);
    set({ windows: nextWindows });
  },

  minimizeWindow: (id) => {
    const { tenantId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
    persist(tenantId, nextWindows);
    set({ windows: nextWindows });
  },

  toggleMaximize: (id) => {
    const { tenantId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, maximized: !w.maximized, minimized: false } : w));
    persist(tenantId, nextWindows);
    set({ windows: nextWindows });
  },

  updateWindowState: (id, state) => {
    const { tenantId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, state: { ...w.state, ...state } } : w));
    persist(tenantId, nextWindows);
    set({ windows: nextWindows });
  },
}));
