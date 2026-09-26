import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";

export interface SavedView {
  label: string;
  searchText: string;
}

type SavedViewsBlob = Record<string, SavedView[]>;

/**
 * Saved list-view search filters, scoped to one page id (e.g. "ncr-list")
 * — same GET-the-whole-blob / PATCH-one-key shape as useThemeSync's theme
 * fetch. `pageKey` is a plain caller-chosen slug, not derived from the
 * route, so two pages sharing a resource (a list and a filtered sub-list)
 * can keep separate saved views if they ever need to.
 */
export function useSavedViews(pageKey: string) {
  const user = useCurrentUser();
  const qc = useQueryClient();

  const { data } = useQuery<SavedViewsBlob>({
    queryKey: ["users/me/saved-views"],
    queryFn: async () => (await apiClient.get("/users/me/saved-views")).data,
    enabled: user != null,
  });

  const views = data?.[pageKey] ?? [];

  const save = useMutation({
    mutationFn: async (view: SavedView) => (await apiClient.patch("/users/me/saved-views", { [pageKey]: [...views, view] })).data,
    onSuccess: (updated: SavedViewsBlob) => qc.setQueryData(["users/me/saved-views"], updated),
  });

  const remove = useMutation({
    mutationFn: async (label: string) => (await apiClient.patch("/users/me/saved-views", { [pageKey]: views.filter((v) => v.label !== label) })).data,
    onSuccess: (updated: SavedViewsBlob) => qc.setQueryData(["users/me/saved-views"], updated),
  });

  return { views, saveView: save.mutate, removeView: remove.mutate, isSaving: save.isPending };
}
