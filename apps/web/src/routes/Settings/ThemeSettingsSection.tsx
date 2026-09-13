import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField } from "../../components/forms/Field";
import type { UserThemePreferences } from "../../api/types";

const MODES: Array<{ value: NonNullable<UserThemePreferences["mode"]>; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match System" },
];

function useMyTheme() {
  return useQuery<UserThemePreferences>({ queryKey: ["users/me/theme"], queryFn: async () => (await apiClient.get("/users/me/theme")).data });
}

/**
 * The real dark/light toggle — replaces the disabled "Light" pill that used
 * to sit here doing nothing (see the old comment this file's git history
 * carries: "AccuQual currently ships one committed dark theme..."). Saves
 * straight to PATCH /users/me/theme on click/blur — same field the global
 * theme engine (lib/theme.ts, wired in AppLayout via useThemeSync) reads,
 * so a change here is visible the instant it saves, not on next reload.
 */
export function ThemeSettingsSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: prefs, isLoading } = useMyTheme();
  const [primaryColor, setPrimaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");

  useEffect(() => {
    if (prefs) {
      setPrimaryColor(prefs.primaryColor ?? "");
      setAccentColor(prefs.accentColor ?? "");
    }
  }, [prefs]);

  const save = useMutation({
    mutationFn: async (body: UserThemePreferences) => (await apiClient.patch("/users/me/theme", body)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users/me/theme"] });
      toast.success("Theme preference saved.");
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save your theme preference.")),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;

  const currentMode = prefs?.mode ?? "dark";

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Appearance</h3>
        <div className="flex items-center gap-3">
          {MODES.map((m) => (
            <button
              key={m.value}
              onClick={() => save.mutate({ mode: m.value })}
              disabled={save.isPending}
              className={
                currentMode === m.value
                  ? "rounded-md border border-primary bg-primary/10 px-3 py-1.5 text-sm font-medium text-primary"
                  : "rounded-md border border-border px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-50"
              }
            >
              {m.label}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          "Match System" follows your OS's own light/dark setting. This is your own preference — it overrides your organization's theme
          mode for you only, everyone else is unaffected.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Your Color Overrides</h3>
        <p className="mb-3 text-xs text-muted-foreground">
          Optional — leave blank to use your organization's theme colors. Only you see these; they don't change AccuQual for anyone
          else.
        </p>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Primary Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor || "#00f3ff"}
                onChange={(e) => setPrimaryColor(e.target.value)}
                className="h-9 w-14 rounded border border-border bg-background"
              />
              <TextField label="" placeholder="Using organization default" value={primaryColor} onChange={(e) => setPrimaryColor(e.target.value)} />
            </div>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Accent Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={accentColor || "#00f3ff"}
                onChange={(e) => setAccentColor(e.target.value)}
                className="h-9 w-14 rounded border border-border bg-background"
              />
              <TextField label="" placeholder="Using organization default" value={accentColor} onChange={(e) => setAccentColor(e.target.value)} />
            </div>
          </label>
          <button
            onClick={() => save.mutate({ primaryColor, accentColor })}
            disabled={save.isPending}
            className="w-fit rounded-md bg-button px-4 py-2 text-sm font-medium text-button-foreground disabled:opacity-60"
          >
            {save.isPending ? "Saving…" : "Save Colors"}
          </button>
        </div>
      </div>
    </div>
  );
}
