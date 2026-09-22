import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";

export interface OnboardingProgress {
  dismissed: boolean;
  completedItems: string[];
}

/** First-run onboarding checklist — same GET/PATCH merge-patch shape as useThemeSync/useSavedViews. Server-side PATCH is admin-only; the checklist component itself only renders for an admin, so this hook doesn't need its own gate. */
export function useOnboardingChecklist() {
  const user = useCurrentUser();
  const qc = useQueryClient();

  const { data } = useQuery<OnboardingProgress>({
    queryKey: ["tenant/onboarding"],
    queryFn: async () => (await apiClient.get("/tenant/onboarding")).data,
    enabled: user?.tenantId != null,
  });

  const patch = useMutation({
    mutationFn: async (body: Partial<OnboardingProgress>) => (await apiClient.patch("/tenant/onboarding", body)).data,
    onSuccess: (updated: OnboardingProgress) => qc.setQueryData(["tenant/onboarding"], updated),
  });

  const progress = data ?? { dismissed: false, completedItems: [] };

  function markComplete(key: string) {
    if (progress.completedItems.includes(key)) return;
    patch.mutate({ completedItems: [...progress.completedItems, key] });
  }

  function dismiss() {
    patch.mutate({ dismissed: true });
  }

  return { progress, markComplete, dismiss };
}
