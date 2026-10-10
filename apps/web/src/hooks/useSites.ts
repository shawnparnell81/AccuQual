import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";
import { useSiteStore } from "../store/siteStore";

export interface PlantSummary {
  id: number;
  name: string;
  code: string;
  status: string;
  isDefault: boolean;
}

export interface PlantContext {
  currentSiteId: number | null;
  canManage: boolean;
  /** True when this person's role has plants.delete. Not implied by a role name. */
  canDelete?: boolean;
  /** True when the role has sites.view_all. */
  canViewAllSites?: boolean;
  /** True when the role has executive.dashboard. */
  executiveDashboard?: boolean;
  siteScope?: "all" | null;
  sites: PlantSummary[];
}

const SITE_SCOPED_QUERIES = new Set(["ncr", "capa", "audits", "calendar", "nav-kpi-counts", "dashboard", "executive"]);

export function useSites() {
  const user = useCurrentUser();
  const enabled = user != null;
  const currentSiteId = useSiteStore((s) => s.currentSiteId);
  const query = useQuery({
    queryKey: ["sites"],
    queryFn: async () => (await apiClient.get<PlantContext>("/sites")).data,
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!query.data) return;
    const scope = query.data.siteScope === "all" ? "all" : null;
    const store = useSiteStore.getState();
    if (store.siteScope !== scope) store.setSiteScope(scope);
    const id = store.currentSiteId;
    const known = query.data.sites.some((site) => site.id === id);
    if (id == null || !known) store.setCurrentSiteId(query.data.currentSiteId);
  }, [query.data]);

  return {
    ...query,
    currentSiteId: currentSiteId ?? query.data?.currentSiteId ?? null,
  };
}

export function useSwitchPlant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (target: number | "all") => {
      const previousId = useSiteStore.getState().currentSiteId;
      const previousScope = useSiteStore.getState().siteScope;
      if (target === "all") useSiteStore.getState().setSiteScope("all");
      else {
        useSiteStore.getState().setSiteScope(null);
        useSiteStore.getState().setCurrentSiteId(target);
      }
      try {
        const body = target === "all" ? { scope: "all" as const } : { siteId: target };
        return (await apiClient.post<PlantContext>("/sites/current", body)).data;
      } catch (err) {
        useSiteStore.getState().setSiteScope(previousScope);
        useSiteStore.getState().setCurrentSiteId(previousId);
        throw err;
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["sites"], data);
      void queryClient.invalidateQueries({
        predicate: (query) => SITE_SCOPED_QUERIES.has(String(query.queryKey[0])),
      });
    },
  });
}

export function clearCurrentPlant() {
  useSiteStore.getState().setCurrentSiteId(null);
  useSiteStore.getState().setSiteScope(null);
}
