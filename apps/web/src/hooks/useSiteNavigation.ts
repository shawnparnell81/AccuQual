import { useMemo } from "react";
import { useSidebarPrefs } from "./useSidebarPrefs";
import { useSites } from "./useSites";
import { useSiteStore } from "../store/siteStore";
import { filterSidebarByAccess } from "../lib/sidebarAccess";
import { developmentMenu, siteShowsDevelopment, withDevelopment } from "../lib/navigationLayout";
import type { SidebarNode } from "../components/layout/sidebarStructure";

/** The arranged menu, plus Development when the selected site is Wellman or All sites. */
export function useSiteNavigation(folders: SidebarNode[]): SidebarNode[] {
  const { access } = useSidebarPrefs();
  const { data, currentSiteId } = useSites();
  const siteScope = useSiteStore((s) => s.siteScope);
  const siteName = data?.sites.find((site) => site.id === currentSiteId)?.name ?? null;
  const showDevelopment = siteShowsDevelopment(siteName, siteScope === "all" ? "all" : null);

  return useMemo(() => {
    if (!showDevelopment) return withDevelopment(folders, []);
    return withDevelopment(folders, filterSidebarByAccess([developmentMenu()], access));
  }, [folders, access, showDevelopment]);
}
