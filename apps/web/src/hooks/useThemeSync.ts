import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";
import { applyTheme } from "../lib/theme";
import type { TenantBranding, UserThemePreferences } from "../api/types";

/**
 * Live theme sync — mounted once in AppLayout (see AiAssistantPanelGate for
 * the same "one gate component per authenticated feature" pattern). Reacts
 * to the real, current tenant branding and this user's own theme override,
 * not a stale snapshot from login, so a tenant admin's color change or this
 * user's own toggle takes effect for every open tab within staleTime
 * without a re-login. main.tsx's synchronous pre-mount stamp (localStorage)
 * covers the frame before this resolves.
 */
export function useThemeSync() {
  const user = useCurrentUser();

  const { data: branding } = useQuery<TenantBranding>({
    queryKey: ["tenant/branding"],
    queryFn: async () => (await apiClient.get("/tenant/branding")).data,
    enabled: user?.tenantId != null, // platform_admin has no tenant — nothing to fetch, defaults apply
  });

  const { data: userTheme } = useQuery<UserThemePreferences>({
    queryKey: ["users/me/theme"],
    queryFn: async () => (await apiClient.get("/users/me/theme")).data,
    enabled: user?.tenantId != null, // GET /users/me/theme sits behind withTenantDb, same as every other /users/* route
  });

  useEffect(() => {
    applyTheme(branding, userTheme);
  }, [branding, userTheme]);
}
