import { create } from "zustand";
import { clampSplitRatio, readSplit, SPLIT_RATIO_DEFAULT, type SplitTarget } from "../lib/splitView";

const RATIO_KEY = "accuqual-split-ratio";

function readRatio(): number {
  try {
    return clampSplitRatio(Number(localStorage.getItem(RATIO_KEY)));
  } catch {
    return SPLIT_RATIO_DEFAULT;
  }
}

function writeRatio(ratio: number) {
  try {
    localStorage.setItem(RATIO_KEY, String(ratio));
  } catch {
    // Preference only.
  }
}

function initialTarget(): SplitTarget {
  if (typeof window === "undefined") return { open: false, path: null };
  return readSplit(window.location.hash);
}

interface SplitState {
  open: boolean;
  rightPath: string | null;
  tabs: string[];
  back: string[];
  forward: string[];
  ratio: number;
  openSplit: (path?: string | null) => void;
  closeSplit: () => void;
  pushRight: (path: string) => void;
  replaceRight: (path: string) => void;
  goRight: (delta: number) => void;
  setRatio: (ratio: number) => void;
  /** After a swap, the caller navigates the left pane to `left`. */
  takeSwap: (leftPath: string) => string;
}

function withTab(tabs: string[], path: string): string[] {
  if (!path.startsWith("/")) return tabs;
  if (tabs.includes(path)) return tabs;
  return [...tabs, path].slice(-12);
}

const initial = initialTarget();

export const useSplitStore = create<SplitState>((set, get) => ({
  open: initial.open,
  rightPath: initial.path,
  tabs: initial.path ? [initial.path] : [],
  back: [],
  forward: [],
  ratio: readRatio(),

  openSplit: (path) => {
    if (path && path.startsWith("/")) {
      set((state) => ({ open: true, rightPath: path, tabs: withTab(state.tabs, path), forward: [] }));
      return;
    }
    set({ open: true });
  },

  closeSplit: () => set({ open: false, rightPath: null, forward: [] }),

  pushRight: (path) => {
    if (!path.startsWith("/")) return;
    const { rightPath, back } = get();
    if (rightPath === path) {
      set((state) => ({ open: true, tabs: withTab(state.tabs, path) }));
      return;
    }
    set((state) => ({
      open: true,
      rightPath: path,
      back: rightPath ? [...back, rightPath].slice(-30) : back,
      forward: [],
      tabs: withTab(state.tabs, path),
    }));
  },

  replaceRight: (path) => {
    if (!path.startsWith("/")) return;
    set((state) => ({ open: true, rightPath: path, tabs: withTab(state.tabs, path) }));
  },

  goRight: (delta) => {
    const { back, forward, rightPath } = get();
    if (delta < 0) {
      const previous = back[back.length - 1];
      if (!previous) return;
      set({
        back: back.slice(0, -1),
        forward: rightPath ? [rightPath, ...forward] : forward,
        rightPath: previous,
        open: true,
      });
      return;
    }
    if (delta > 0) {
      const next = forward[0];
      if (!next) return;
      set({
        forward: forward.slice(1),
        back: rightPath ? [...back, rightPath] : back,
        rightPath: next,
        open: true,
      });
    }
  },

  setRatio: (ratio) => {
    const next = clampSplitRatio(ratio);
    writeRatio(next);
    set({ ratio: next });
  },

  takeSwap: (leftPath) => {
    const right = get().rightPath && get().rightPath!.startsWith("/") ? get().rightPath! : leftPath;
    const nextRight = leftPath.startsWith("/") ? leftPath : "/";
    set((state) => ({
      open: true,
      rightPath: nextRight,
      back: [],
      forward: [],
      tabs: withTab(state.tabs, nextRight),
    }));
    return right;
  },
}));
