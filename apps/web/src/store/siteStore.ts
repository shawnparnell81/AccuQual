import { create } from "zustand";

/**
 * Plant the open tab is working in. Sent as X-AccuQual-Site so switching
 * does not mint a new login. Not persisted: a fresh load asks the server
 * which plant this user last saved.
 */
interface SiteState {
  currentSiteId: number | null;
  setCurrentSiteId: (siteId: number | null) => void;
}

export const useSiteStore = create<SiteState>((set) => ({
  currentSiteId: null,
  setCurrentSiteId: (currentSiteId) => set({ currentSiteId }),
}));
