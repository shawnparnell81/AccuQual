import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "../api/client";
import { useCurrentUser } from "./useAuth";
import { applyTheme } from "../lib/theme";
import type { CompanyBranding, UserThemePreferences } from "../api/types";

/**
 * Live theme sync — mounted once in AppLayout (see AiAssistantPanelGate for
 * the same "one gate component per authenticated feature" pattern). Reacts
 * to the real, current company branding and this user's own theme override,
 * not a stale snapshot from login, so an administrator's color change or this
 * user's own toggle takes effect for every open tab within staleTime
 * without a re-login. main.tsx's synchronous pre-mount stamp (localStorage)
 * covers the frame before this resolves — this hook waits until those
 * queries settle so that first paint is not wiped back to the built-in
 * palette and then painted again.
 */
export function useThemeSync() {
  const user = useCurrentUser();
  const enabled = user != null;

  const brandingQuery = useQuery<CompanyBranding>({
    queryKey: ["company/branding"],
    queryFn: async () => (await apiClient.get("/company/branding")).data,
    enabled,
  });

  const themeQuery = useQuery<UserThemePreferences>({
    queryKey: ["users/me/theme"],
    queryFn: async () => (await apiClient.get("/users/me/theme")).data,
    enabled,
  });

  const branding = brandingQuery.isError ? undefined : brandingQuery.data;
  const userTheme = themeQuery.data;
  const ready = !enabled || (brandingQuery.isFetched && themeQuery.isFetched);

  useEffect(() => {
    if (!ready) return;
    // Keep the boot snapshot when we could not read this user's overrides.
    if (enabled && themeQuery.isError) return;
    applyTheme(branding, userTheme);
  }, [ready, enabled, branding, userTheme, themeQuery.isError]);

  useEffect(() => {
    if (!ready || themeQuery.isError) return;
    if (userTheme?.mode === "light" || userTheme?.mode === "dark") return;
    const mq = window.matchMedia?.("(prefers-color-scheme: light)");
    if (!mq) return;
    const onChange = () => applyTheme(branding, userTheme);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [ready, branding, userTheme, themeQuery.isError]);
}
