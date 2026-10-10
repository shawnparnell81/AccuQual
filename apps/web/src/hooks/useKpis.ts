import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import type { KpiLayout, KpiPayload } from "../lib/kpiView";

export const KPI_QUERY_KEY = ["kpis"] as const;

/** Live objectives and charts. The same query feeds /kpis, Home, and the executive dashboard. */
export function useKpis(enabled = true) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: KPI_QUERY_KEY,
    queryFn: async () => (await apiClient.get<KpiPayload>("/kpis")).data,
    refetchInterval: 60_000,
    enabled,
  });

  const layout = useMutation({
    mutationFn: async (body: { surface: "home" | "executive"; order: string[] }) => (await apiClient.put<KpiLayout>("/kpis/layout", body)).data,
    onMutate: async (body) => {
      await qc.cancelQueries({ queryKey: KPI_QUERY_KEY });
      const previous = qc.getQueryData<KpiPayload>(KPI_QUERY_KEY);
      if (previous) {
        qc.setQueryData<KpiPayload>(KPI_QUERY_KEY, {
          ...previous,
          layout: {
            ...previous.layout,
            [body.surface]: body.order,
            homeIsDefault: body.surface === "home" ? false : previous.layout.homeIsDefault,
            executiveIsDefault: body.surface === "executive" ? false : previous.layout.executiveIsDefault,
          },
        });
      }
      return { previous };
    },
    onError: (_err, _body, context) => {
      if (context?.previous) qc.setQueryData(KPI_QUERY_KEY, context.previous);
    },
    onSuccess: (next) => {
      qc.setQueryData<KpiPayload>(KPI_QUERY_KEY, (current) => (current ? { ...current, layout: next } : current));
    },
  });

  const reset = useMutation({
    mutationFn: async (surface: "home" | "executive" | "all") => (await apiClient.delete<KpiLayout>("/kpis/layout", { params: { surface } })).data,
    onSuccess: (next) => {
      qc.setQueryData<KpiPayload>(KPI_QUERY_KEY, (current) => (current ? { ...current, layout: next } : current));
    },
  });

  return {
    query,
    saveOrder: layout.mutate,
    resetLayout: reset.mutate,
    pending: layout.isPending || reset.isPending,
  };
}
