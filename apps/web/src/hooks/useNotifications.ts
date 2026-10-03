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
export function useNotifications(limit = 30) {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery<{ notifications: NotificationEntry[]; unreadCount: number }>({
    queryKey: ["notifications/me", limit],
    queryFn: async () => (await apiClient.get("/notifications/me", { params: { limit } })).data,
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const markRead = useMutation({
    mutationFn: async (id: number) => apiClient.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications/me"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => apiClient.post("/notifications/me/read-all"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications/me"] }),
  });

  const openNotice = useMutation({
    mutationFn: async (id: number) =>
      (await apiClient.post<{ status: "open"; path: string } | { status: "none" } | { status: "unavailable" }>(`/notifications/${id}/open`)).data,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications/me"] }),
  });

  return {
    notifications: data?.notifications ?? [],
    unreadCount: data?.unreadCount ?? 0,
    isLoading,
    markRead: markRead.mutate,
    markAllRead: markAllRead.mutate,
    markingAll: markAllRead.isPending,
    openNotice: openNotice.mutateAsync,
  };
}
