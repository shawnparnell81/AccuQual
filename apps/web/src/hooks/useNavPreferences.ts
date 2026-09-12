import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";

const QUERY_KEY = ["nav-hidden-items"];

/** Scope strings: "department:<key>" hides a whole dropdown, "item:<departmentKey>:<itemKey>" hides one entry within it. */
export function departmentScope(departmentKey: string): string {
  return `department:${departmentKey}`;
}
export function itemScope(departmentKey: string, itemKey: string): string {
  return `item:${departmentKey}:${itemKey}`;
}

export function useHiddenNavScopes() {
  const { data = [] } = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async () => (await apiClient.get<string[]>("/nav/hidden")).data,
    staleTime: 30_000,
  });
  return data;
}

export function useSetNavScopeHidden() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ scope, hidden }: { scope: string; hidden: boolean }) =>
      hidden ? apiClient.post("/nav/hidden", { scope }) : apiClient.delete("/nav/hidden", { data: { scope } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: QUERY_KEY }),
  });
}
