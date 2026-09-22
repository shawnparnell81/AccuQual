import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";

export interface NotificationEntry {
  id: number;
  subject: string;
  body: string;
  status: "sent" | "failed" | "logged_only";
  relatedEntityType: string | null;
  relatedEntityId: number | null;
  createdAt: string;
  readAt: string | null;
}

/** The in-app notification bell — polled the same way TopNav's own nav-KPI badges are (60s interval, 30s stale). */
export function useNotifications() {
  const qc = useQueryClient();

  const { data } = useQuery<{ notifications: NotificationEntry[]; unreadCount: number }>({
    queryKey: ["notifications/me"],
    queryFn: async () => (await apiClient.get("/notifications/me")).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => apiClient.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications/me"] }),
  });

  return { notifications: data?.notifications ?? [], unreadCount: data?.unreadCount ?? 0, markRead: markRead.mutate };
}
