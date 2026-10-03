import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";

/**
 * Badge for the newest company note. `hasUnseen` stays false while the
 * preference is still loading, and stays false when there is no current note.
 */
export function useChangelogSeen(latestId: string | null) {
  const user = useCurrentUser();
  const qc = useQueryClient();

  const { data } = useQuery<{ lastSeenVersion: string | null }>({
    queryKey: ["users/me/changelog-seen"],
    queryFn: async () => (await apiClient.get("/users/me/changelog-seen")).data,
    enabled: user != null,
  });

  const markSeen = useMutation({
    mutationFn: async (version: string) => (await apiClient.patch("/users/me/changelog-seen", { version })).data,
    onSuccess: (updated) => qc.setQueryData(["users/me/changelog-seen"], updated),
  });

  const hasUnseen = data !== undefined && latestId !== null && data.lastSeenVersion !== latestId;

  return { hasUnseen, markSeenAsCurrent: () => latestId && markSeen.mutate(latestId) };
}
