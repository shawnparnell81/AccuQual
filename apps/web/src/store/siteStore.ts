import { create } from "zustand";

/**
 * Plant the open tab is working in. Sent as X-AccuQual-Site so switching
 * does not mint a new login. Not persisted: a fresh load asks the server
 * which plant this user last saved. "all" lists every site this person
 * may see and still keeps the saved plant as the default for new records.
 */
interface SiteState {
  currentSiteId: number | null;
  siteScope: "all" | null;
  setCurrentSiteId: (siteId: number | null) => void;
  setSiteScope: (siteScope: "all" | null) => void;
}

export const useSiteStore = create<SiteState>((set) => ({
  currentSiteId: null,
  siteScope: null,
  setCurrentSiteId: (currentSiteId) => set({ currentSiteId }),
  setSiteScope: (siteScope) => set({ siteScope }),
}));

/** Header value for the plant this tab is looking at. */
export function siteHeaderValue(): string | null {
  const { siteScope, currentSiteId } = useSiteStore.getState();
  if (siteScope === "all") return "all";
  if (currentSiteId) return String(currentSiteId);
  return null;
}
