import { create } from "zustand";

interface DirtyPathState {
  paths: Record<string, boolean>;
  setDirtyPath: (path: string, dirty: boolean) => void;
}

/** Unsaved edits keyed by the tab path (the route pathname). */
export const useDirtyPathStore = create<DirtyPathState>((set) => ({
  paths: {},
  setDirtyPath: (path, dirty) =>
    set((state) => {
      if (Boolean(state.paths[path]) === dirty) return state;
      const paths = { ...state.paths };
      if (dirty) paths[path] = true;
      else delete paths[path];
      return { paths };
    }),
}));
