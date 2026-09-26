import { create } from "zustand";
import type { WindowInstance, WindowType } from "../types/window";

const BASE_Z = 100;

interface WindowState {
  ownerId: string | null;
  windows: WindowInstance[];
  /** Called once on login/app load — restores only this user's saved workspace. */
  loadForUser: (ownerId: string) => void;
  /** Called on logout — one person's windows must never show up for the next person, so windows never carry over. */
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

function storageKey(ownerId: string) {
  return `accuqual_workspace_${ownerId}`;
}

function persist(ownerId: string | null, windows: WindowInstance[]) {
  if (!ownerId) return;
  try {
    localStorage.setItem(storageKey(ownerId), JSON.stringify(windows));
  } catch {
    // localStorage unavailable (private mode, quota, ...) — workspace just won't survive a refresh.
  }
}

function restore(ownerId: string): WindowInstance[] {
  try {
    const raw = localStorage.getItem(storageKey(ownerId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as WindowInstance[];
    // Belt-and-suspenders: a window whose ownerId doesn't match the key it was stored
    // under should never be restorable — this is the "IDs cannot collide between users" guarantee.
    return parsed.filter((w) => w.ownerId === ownerId);
  } catch {
    return [];
  }
}

let zCounter = BASE_Z;

export const useWindowStore = create<WindowState>((set, get) => ({
  ownerId: null,
  windows: [],

  loadForUser: (ownerId) => {
    const windows = restore(ownerId);
    zCounter = BASE_Z + windows.length;
    set({ ownerId, windows });
  },

  // Also removes the persisted workspace, not just the in-memory windows —
  // otherwise the next loadForUser() (any user logging into this same
  // company, including this same user's own next login) reads the stale
  // localStorage entry right back, maximized state and all, silently
  // covering their very first screen with someone's leftover form. Found
  // live (QA sweep review): logging out never actually cleared this.
  clear: () => {
    const { ownerId } = get();
    if (ownerId) {
      try {
        localStorage.removeItem(storageKey(ownerId));
      } catch {
        // localStorage unavailable — nothing persisted to clean up anyway.
      }
    }
    set({ ownerId: null, windows: [] });
  },

  openWindow: (win, id) => {
    const { ownerId, windows } = get();
    if (!ownerId) throw new Error("Not signed in — cannot open a window");

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
      ownerId,
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
    persist(ownerId, nextWindows);
    set({ windows: nextWindows });
    return newId;
  },

  closeWindow: (id) => {
    const { ownerId, windows } = get();
    const nextWindows = windows.filter((w) => w.id !== id);
    persist(ownerId, nextWindows);
    set({ windows: nextWindows });
  },

  focusWindow: (id) => {
    const { ownerId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, zIndex: ++zCounter, minimized: false } : w));
    persist(ownerId, nextWindows);
    set({ windows: nextWindows });
  },

  updateRect: (id, rect) => {
    const { ownerId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, ...rect } : w));
    persist(ownerId, nextWindows);
    set({ windows: nextWindows });
  },

  minimizeWindow: (id) => {
    const { ownerId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, minimized: true } : w));
    persist(ownerId, nextWindows);
    set({ windows: nextWindows });
  },

  toggleMaximize: (id) => {
    const { ownerId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, maximized: !w.maximized, minimized: false } : w));
    persist(ownerId, nextWindows);
    set({ windows: nextWindows });
  },

  updateWindowState: (id, state) => {
    const { ownerId, windows } = get();
    const nextWindows = windows.map((w) => (w.id === id ? { ...w, state: { ...w.state, ...state } } : w));
    persist(ownerId, nextWindows);
    set({ windows: nextWindows });
  },
}));
