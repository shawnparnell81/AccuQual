import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Palette } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { applyTheme, COLOR_SCHEME_LABELS, getStoredScheme, resolveScheme, type ColorScheme } from "../../lib/theme";
import type { CompanyBranding, UserThemePreferences } from "../../api/types";

/**
 * Header palette control. One click switches AccuQual Classic and DMA
 * Industries. Light/dark stays on the neighboring toggle and is not changed
 * here. The choice is the same profile field Settings → Theme writes.
 */
export function ColorSchemeButton() {
  const user = useCurrentUser();
  const queryClient = useQueryClient();
  const { data: prefs } = useQuery<UserThemePreferences>({
    queryKey: ["users/me/theme"],
    queryFn: async () => (await apiClient.get("/users/me/theme")).data,
    enabled: user != null,
  });
  const { data: branding } = useQuery<CompanyBranding>({
    queryKey: ["company/branding"],
    queryFn: async () => (await apiClient.get("/company/branding")).data,
    enabled: user != null,
  });

  const scheme = resolveScheme(prefs?.scheme ?? getStoredScheme() ?? undefined);
  const next: ColorScheme = scheme === "dma" ? "classic" : "dma";

  const save = useMutation({
    mutationFn: async (scheme: ColorScheme) => (await apiClient.patch<UserThemePreferences>("/users/me/theme", { scheme })).data,
    onMutate: (scheme) => {
      const optimistic = { ...prefs, scheme };
      queryClient.setQueryData(["users/me/theme"], optimistic);
      applyTheme(branding, optimistic);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["users/me/theme"], data);
      applyTheme(branding, data);
    },
    onError: () => {
      queryClient.setQueryData(["users/me/theme"], prefs);
      applyTheme(branding, prefs);
    },
  });

  const label = COLOR_SCHEME_LABELS[scheme];
  const nextLabel = COLOR_SCHEME_LABELS[next];

  return (
    <button
      type="button"
      className="aq-icon-btn"
      aria-pressed={scheme === "dma"}
      aria-label={`Color scheme: ${label}. Switch to ${nextLabel}`}
      title={`${label} — switch to ${nextLabel}`}
      onClick={() => save.mutate(next)}
    >
      <Palette size={18} />
    </button>
  );
}
