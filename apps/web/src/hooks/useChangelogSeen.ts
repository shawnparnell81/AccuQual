import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";
import { LATEST_CHANGELOG_VERSION } from "../data/changelog";

/**
 * What's new — same shape as useThemeSync's per-user preference fetch,
 * just a scalar instead of a jsonb blob. `hasUnseen` is `false` while the
 * query is still loading (`data` undefined) so the badge never flashes
 * on for a frame before the real value arrives.
 */
export function useChangelogSeen() {
  const user = useCurrentUser();
  const qc = useQueryClient();

  const { data } = useQuery<{ lastSeenVersion: string | null }>({
    queryKey: ["users/me/changelog-seen"],
    queryFn: async () => (await apiClient.get("/users/me/changelog-seen")).data,
    enabled: user?.tenantId != null,
  });

  const markSeen = useMutation({
    mutationFn: async (version: string) => (await apiClient.patch("/users/me/changelog-seen", { version })).data,
    onSuccess: (updated) => qc.setQueryData(["users/me/changelog-seen"], updated),
  });

  const hasUnseen = data !== undefined && LATEST_CHANGELOG_VERSION !== null && data.lastSeenVersion !== LATEST_CHANGELOG_VERSION;

  return { hasUnseen, markSeenAsCurrent: () => LATEST_CHANGELOG_VERSION && markSeen.mutate(LATEST_CHANGELOG_VERSION) };
}
