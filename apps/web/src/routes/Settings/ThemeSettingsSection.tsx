import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField } from "../../components/forms/Field";
import { useCurrentUser } from "../../hooks/useAuth";
import { applyTheme, COLOR_SCHEME_LABELS, deriveThemeVars, resolveMode, resolveScheme, type ColorScheme } from "../../lib/theme";
import type { CompanyBranding, UserThemePreferences } from "../../api/types";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";

const MODES: Array<{ value: NonNullable<UserThemePreferences["mode"]>; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match System" },
];

/** Fixed chips so each card still shows its own palette while the other scheme is active. */
const SCHEME_CARDS: Array<{ id: ColorScheme; blurb: string; chips: [string, string, string] }> = [
  { id: "classic", blurb: "DMA Blue on a cool slate canvas", chips: ["#0B1220", "#0A3C7B", "#F8FAFC"] },
  { id: "dma", blurb: "DMA Blue, steel, and logo indigo", chips: ["#0A3C7B", "#507099", "#293170"] },
];

function useMyTheme() {
  return useQuery<UserThemePreferences>({ queryKey: ["users/me/theme"], queryFn: async () => (await apiClient.get("/users/me/theme")).data });
}

/**
 * Light, dark, and color-scheme controls. Each change saves with
 * PATCH /users/me/theme, which lib/theme.ts applies immediately.
 */
export function ThemeSettingsSection() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const { data: prefs, isLoading } = useMyTheme();
  const { data: branding } = useQuery<CompanyBranding>({
    queryKey: ["company/branding"],
    queryFn: async () => (await apiClient.get("/company/branding")).data,
    enabled: user != null,
  });
  const [primaryColor, setPrimaryColor] = useState("");
  const [accentColor, setAccentColor] = useState("");

  useEffect(() => {
    if (prefs) {
      setPrimaryColor(prefs.primaryColor ?? "");
      setAccentColor(prefs.accentColor ?? "");
    }
  }, [prefs]);

  const save = useMutation({
    mutationFn: async (body: UserThemePreferences) => (await apiClient.patch<UserThemePreferences>("/users/me/theme", body)).data,
    onMutate: (body) => {
      const previous = prefs;
      const optimistic = { ...prefs, ...body };
      queryClient.setQueryData(["users/me/theme"], optimistic);
      applyTheme(branding, optimistic);
      return { previous };
    },
    onSuccess: (data) => {
      queryClient.setQueryData(["users/me/theme"], data);
      applyTheme(branding, data);
      toast.success("Theme preference saved.");
    },
    onError: (err, _body, context) => {
      queryClient.setQueryData(["users/me/theme"], context?.previous);
      applyTheme(branding, context?.previous);
      toast.error(extractErrorMessage(err, "Couldn't save your theme preference."));
    },
  });

  const currentMode = prefs?.mode ?? "dark";
  const currentScheme = resolveScheme(prefs?.scheme);
  const previewStyle = useMemo(() => {
    const vars = deriveThemeVars({
      mode: resolveMode(currentMode),
      branding,
      userPrefs: {
        primaryColor: primaryColor || undefined,
        accentColor: accentColor || undefined,
      },
    });
    return vars as CSSProperties;
  }, [accentColor, branding, currentMode, primaryColor]);

  if (isLoading) return <LoadingPlaceholder />;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-border bg-card p-4">
        <h3 className="mb-2 text-sm font-medium">Appearance</h3>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Color scheme</p>
        <div className="mb-2 grid gap-3 sm:grid-cols-2" role="group" aria-label="Color scheme">
          {SCHEME_CARDS.map((card) => {
            const selected = currentScheme === card.id;
            return (
              <button
                key={card.id}
                type="button"
                aria-pressed={selected}
                onClick={() => {
                  if (selected) return;
                  save.mutate({ scheme: card.id });
                }}
                className={
                  selected
                    ? "rounded-lg border-2 border-primary bg-primary/10 p-3 text-left"
                    : "rounded-lg border-2 border-border p-3 text-left hover:bg-muted"
                }
              >
                <span className="mb-2 flex gap-1.5" aria-hidden>
                  {card.chips.map((color) => (
                    <span key={color} className="h-8 flex-1 rounded-md border border-border" style={{ backgroundColor: color }} />
                  ))}
                </span>
                <span className="block text-sm font-medium">{COLOR_SCHEME_LABELS[card.id]}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{card.blurb}</span>
              </button>
            );
          })}
        </div>
        <p className="mb-4 text-xs text-muted-foreground">
          One click switches the whole app. AccuQual Classic is the original palette. DMA Industries uses that brand's navy, steel blue,
          and logo indigo. Light and dark, including the header toggle, apply to either scheme and stay separate from this choice.
        </p>
        <p className="mb-2 text-xs font-medium text-muted-foreground">Light or dark</p>
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
          Optional — leave blank to use your organization's theme colors. Only you see these, and only while AccuQual Classic is
          selected. DMA Industries keeps its own palette; these colors come back when you switch to Classic. Primary recolors buttons,
          selected navigation, focus rings, and the page around them (background, cards, text, borders) for the Light or Dark mode
          above — changing a color never flips that mode or the scheme. Accent recolors the wordmark stripe, role badge, secondary
          links, and chart markers. Each color is adjusted for contrast in the mode you're in.
        </p>
        <div className="mb-4 rounded-md border border-border bg-background p-3 text-foreground" style={previewStyle}>
          <p className="text-sm">Page text</p>
          <p className="text-xs text-muted-foreground">Muted text on the page background</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md bg-primary px-3 py-1 text-sm font-medium text-primary-foreground">Primary</span>
            <span className="rounded-full border border-accent/40 bg-accent/15 px-2 py-0.5 text-xs font-medium text-accent">Accent</span>
            <span className="rounded-md border border-border bg-card px-2 py-1 text-xs">Card</span>
          </div>
        </div>
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium">Primary Color</span>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={primaryColor || "#0A3C7B"}
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
                value={accentColor || "#507099"}
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
