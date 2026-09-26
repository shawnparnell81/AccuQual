import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Moon, Sun } from "lucide-react";
import { apiClient } from "../../api/client";
import { useCurrentUser } from "../../hooks/useAuth";
import { applyTheme, resolveMode } from "../../lib/theme";
import type { CompanyBranding, UserThemePreferences } from "../../api/types";

/**
 * Header sun/moon control. Writes the same Settings → Theme preference
 * (PATCH /users/me/theme) the rest of the app already reads, so a click
 * here and a click on that page stay in lockstep.
 */
export function ThemeToggleButton() {
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

  const mode = resolveMode(prefs?.mode);
  const next = mode === "dark" ? "light" : "dark";

  const save = useMutation({
    mutationFn: async (mode: "light" | "dark") => (await apiClient.patch<UserThemePreferences>("/users/me/theme", { mode })).data,
    onMutate: (mode) => {
      const optimistic = { ...prefs, mode };
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

  return (
    <button type="button" className="aq-icon-btn" aria-label="Toggle light or dark mode" title={mode === "dark" ? "Switch to light" : "Switch to dark"} onClick={() => save.mutate(next)}>
      {mode === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
