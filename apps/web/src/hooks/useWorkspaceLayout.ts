import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";

export const HOME_SECTION_IDS = ["hero", "waiting-on-me", "kpis", "next", "whos-late", "waiting", "audits", "documents", "training", "onboarding", "attention", "inbox", "calendar"] as const;
export const DASHBOARD_SECTION_IDS = ["hero", "open-work", "kpis", "engineering", "trend", "aging", "stuck", "activity"] as const;

type Surface = "home" | "dashboard";
type SurfaceLayout = { order?: string[]; hidden?: string[] };
type WorkspaceLayout = { home?: SurfaceLayout; dashboard?: SurfaceLayout; waitingOnMe?: { sort?: string; group?: string; module?: string; timing?: string } } | null;

const DEFAULTS: Record<Surface, readonly string[]> = {
  home: HOME_SECTION_IDS,
  dashboard: DASHBOARD_SECTION_IDS,
};

function mergeOrder(defaults: readonly string[], saved: string[] | undefined): string[] {
  const known = new Set<string>(defaults);
  const order = (saved ?? []).filter((id) => known.has(id));
  return [...order, ...defaults.filter((id) => !order.includes(id))];
}

/** This person's home or dashboard arrangement. Another user's row is never read. */
export function useWorkspaceSurface(surface: Surface, allowed: (id: string) => boolean) {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const defaults = DEFAULTS[surface];
  const query = useQuery<WorkspaceLayout>({
    queryKey: ["users/me/workspace-layout"],
    queryFn: async () => (await apiClient.get<WorkspaceLayout>("/users/me/workspace-layout")).data,
    enabled: user != null,
  });

  const saved = query.data?.[surface];
  const hidden = new Set(saved?.hidden ?? []);
  const order = mergeOrder(defaults, saved?.order);
  const shown = order.filter((id) => !hidden.has(id) && allowed(id));
  const arrangeIds = order.filter((id) => allowed(id));

  const save = useMutation({
    mutationFn: async (next: { order: string[]; hidden: string[] }) =>
      (await apiClient.put<WorkspaceLayout>("/users/me/workspace-layout", { [surface]: next })).data,
    onSuccess: (updated) => qc.setQueryData(["users/me/workspace-layout"], updated),
  });

  const reset = useMutation({
    mutationFn: async () => (await apiClient.delete<WorkspaceLayout>("/users/me/workspace-layout", { params: { surface } })).data,
    onSuccess: (updated) => qc.setQueryData(["users/me/workspace-layout"], updated),
  });

  return {
    shown,
    arrangeIds,
    hidden,
    save: (next: { order: string[]; hidden: string[] }) => save.mutate(next),
    reset: () => reset.mutate(),
    pending: save.isPending || reset.isPending,
  };
}
