import { useMemo } from "react";
import { useQueries } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { createResourceHooks } from "../api/resourceHooks";
import type { Ncr } from "../api/types";
import type { NcrSearchRow } from "../lib/ncrSearch";
import { useSites } from "./useSites";

const ncrHooks = createResourceHooks<Ncr>("ncr");

/**
 * NCRs on every plant this person can see, including closed ones.
 * The list request does not drop a status, and each plant is asked on its own
 * so a closed issue on another plant still turns up in search.
 */
export function useVisibleNcrs(): { rows: NcrSearchRow[]; isLoading: boolean } {
  const plants = useSites();
  const sites = plants.data?.sites ?? [];
  const current = ncrHooks.useList(undefined, { enabled: sites.length === 0 });
  const queries = useQueries({
    queries: sites.map((site) => ({
      queryKey: ["ncr", "visible-site", site.id],
      queryFn: async () =>
        (await apiClient.get<Ncr[]>("/ncr", { headers: { "X-AccuQual-Site": String(site.id) } })).data,
      staleTime: 15_000,
    })),
  });

  const rows = useMemo(() => {
    const byId = new Map<number, NcrSearchRow>();
    if (sites.length === 0) {
      for (const ncr of current.data ?? []) byId.set(ncr.id, { ...ncr, siteName: null });
      return [...byId.values()];
    }
    sites.forEach((site, index) => {
      for (const ncr of queries[index]?.data ?? []) {
        if (!byId.has(ncr.id)) byId.set(ncr.id, { ...ncr, siteName: site.name });
      }
    });
    return [...byId.values()];
  }, [current.data, queries, sites]);

  const isLoading = sites.length === 0 ? current.isLoading : queries.some((query) => query.isLoading);
  return { rows, isLoading };
}
