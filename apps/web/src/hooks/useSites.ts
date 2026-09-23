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
  sites: PlantSummary[];
}

const SITE_SCOPED_QUERIES = new Set(["ncr", "capa", "audits", "calendar", "nav-kpi-counts"]);

export function useSites() {
  const user = useCurrentUser();
  const enabled = user?.tenantId != null && user.roleName !== "platform_admin";
  const currentSiteId = useSiteStore((s) => s.currentSiteId);
  const query = useQuery({
    queryKey: ["sites"],
    queryFn: async () => (await apiClient.get<PlantContext>("/sites")).data,
    enabled,
    staleTime: 30_000,
  });

  useEffect(() => {
    if (!query.data) return;
    const known = query.data.sites.some((site) => site.id === currentSiteId);
    if (currentSiteId == null || !known) useSiteStore.getState().setCurrentSiteId(query.data.currentSiteId);
  }, [query.data, currentSiteId]);

  return {
    ...query,
    currentSiteId: currentSiteId ?? query.data?.currentSiteId ?? null,
  };
}

export function useSwitchPlant() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (siteId: number) => {
      const previous = useSiteStore.getState().currentSiteId;
      useSiteStore.getState().setCurrentSiteId(siteId);
      try {
        return (await apiClient.post<PlantContext>("/sites/current", { siteId })).data;
      } catch (err) {
        useSiteStore.getState().setCurrentSiteId(previous);
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
}
