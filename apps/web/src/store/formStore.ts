import { create } from "zustand";

/**
 * Tracks save status per open form window (keyed by window id — see
 * window-manager/useWindowStore.ts). The actual field *data* lives in that
 * window's own persisted `state`, not duplicated here; this store's job is
 * just "is this window's form dirty / currently saving", which every
 * FormEditor instance needs but which has no natural home on WindowInstance.
 */
interface FormStoreState {
  dirtyByWindow: Record<string, boolean>;
  savingByWindow: Record<string, boolean>;
  setDirty: (windowId: string, dirty: boolean) => void;
  setSaving: (windowId: string, saving: boolean) => void;
}

export const useFormStore = create<FormStoreState>((set) => ({
  dirtyByWindow: {},
  savingByWindow: {},
  setDirty: (windowId, dirty) => set((s) => ({ dirtyByWindow: { ...s.dirtyByWindow, [windowId]: dirty } })),
  setSaving: (windowId, saving) => set((s) => ({ savingByWindow: { ...s.savingByWindow, [windowId]: saving } })),
}));
