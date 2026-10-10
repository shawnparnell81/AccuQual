import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useEffectivePermissions } from "./useEffectivePermissions";
import { useCurrentUser } from "./useAuth";
import { EMPTY_SIDEBAR_SHORTCUTS, type SidebarShortcutPrefs } from "../lib/sidebarShortcuts";
import type { SidebarAccess } from "../lib/sidebarAccess";
import { readSidebarCache, writeSidebarCache } from "../lib/sidebarUserLayout";
import { useAiFeaturesEnabled } from "./useAssistantName";

export function sidebarPrefsQueryKey(userId: number | undefined) {
  return ["sidebar-shortcuts", userId] as const;
}

/** This person's menu, from the server, with a browser copy so the sidebar can paint immediately. */
export function useSidebarPrefs() {
  const user = useCurrentUser();
  const qc = useQueryClient();
  const { effective, isLoading } = useEffectivePermissions();
  const userId = user?.id;
  const cached = useMemo(() => (userId ? readSidebarCache(localStorage, userId) : null), [userId]);

  const query = useQuery({
    queryKey: sidebarPrefsQueryKey(userId),
    enabled: Boolean(userId),
    placeholderData: () => cached?.prefs,
    queryFn: async () => {
      const prefs = (await apiClient.get<SidebarShortcutPrefs>("/users/me/sidebar-shortcuts")).data;
      if (userId) writeSidebarCache(localStorage, userId, { prefs });
      return prefs;
    },
  });

  useEffect(() => {
    if (!userId || !effective) return;
    writeSidebarCache(localStorage, userId, { levels: effective });
  }, [effective, userId]);

  const prefs = query.data ?? cached?.prefs ?? EMPTY_SIDEBAR_SHORTCUTS;
  const levels = !isLoading && effective ? effective : (cached?.levels ?? null);
  const aiFeatures = useAiFeaturesEnabled();
  const access = useMemo<SidebarAccess>(() => ({ levels, aiFeatures }), [levels, aiFeatures]);

  const save = useMutation({
    mutationFn: async (next: SidebarShortcutPrefs) => (await apiClient.put<SidebarShortcutPrefs>("/users/me/sidebar-shortcuts", next)).data,
    onSuccess: (next) => {
      qc.setQueryData(sidebarPrefsQueryKey(userId), next);
      if (userId) writeSidebarCache(localStorage, userId, { prefs: next });
    },
  });

  const reset = useMutation({
    mutationFn: async () => (await apiClient.put<SidebarShortcutPrefs>("/users/me/sidebar-shortcuts", EMPTY_SIDEBAR_SHORTCUTS)).data,
    onSuccess: (next) => {
      qc.setQueryData(sidebarPrefsQueryKey(userId), next);
      if (userId) writeSidebarCache(localStorage, userId, { prefs: next });
    },
  });

  return { prefs, access, save, reset };
}
