import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "./client";
import { useSiteStore } from "../store/siteStore";

/**
 * Generic React Query hooks bound to one REST resource, mirroring the backend's
 * crudFactory pattern. Module pages compose these with bespoke action hooks
 * (assign/verify/close/...) defined alongside each page.
 */
const SITE_SCOPED_RESOURCES = new Set(["ncr", "capa", "audits"]);

export function createResourceHooks<T extends { id: number }>(resource: string) {
  const key = [resource];
  const siteScoped = SITE_SCOPED_RESOURCES.has(resource);

  function useList(params?: Record<string, unknown>) {
    const siteId = useSiteStore((s) => (siteScoped ? s.currentSiteId : null));
    return useQuery({
      queryKey: siteScoped ? [...key, "site", siteId, params] : [...key, params],
      queryFn: async () => (await apiClient.get<T[]>(`/${resource}`, { params })).data,
    });
  }

  function useOne(id: number | undefined) {
    return useQuery({
      queryKey: [...key, id],
      queryFn: async () => (await apiClient.get<T>(`/${resource}/${id}`)).data,
      enabled: id !== undefined,
    });
  }

  function useCreate() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (payload: Partial<T>) => (await apiClient.post<T>(`/${resource}`, payload)).data,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    });
  }

  function useUpdate() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async ({ id, ...payload }: Partial<T> & { id: number }) =>
        (await apiClient.patch<T>(`/${resource}/${id}`, payload)).data,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    });
  }

  function useAction(action: string) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async ({ id, ...payload }: { id: number } & Record<string, unknown>) =>
        (await apiClient.post(`/${resource}/${id}/${action}`, payload)).data,
      onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    });
  }

  function useDelete() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: async (id: number) => apiClient.delete(`/${resource}/${id}`),
      onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
    });
  }

  return { useList, useOne, useCreate, useUpdate, useAction, useDelete };
}
