import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";
import { readRecentRecords, withoutDeadPaths, writeRecentRecords, type RecentRecord } from "../lib/recentRecords";

/** Recent records the person opened, without rows whose saved form was deleted. */
export function useRecentRecords(): RecentRecord[] {
  const user = useCurrentUser();
  const userId = user?.id;
  const query = useQuery({
    queryKey: ["recent-records", userId],
    queryFn: async () => {
      const current = readRecentRecords(userId);
      if (current.length === 0) return current;
      const params = new URLSearchParams();
      for (const row of current) params.append("path", row.path);
      const res = await apiClient.get<{ live: string[] }>(`/document-folders/live-paths?${params.toString()}`);
      const next = withoutDeadPaths(current, res.data.live);
      if (next.length !== current.length) writeRecentRecords(next, userId);
      return next;
    },
    staleTime: 15_000,
  });
  return query.data ?? readRecentRecords(userId);
}
