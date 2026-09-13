import type { TenantBranding, UserThemePreferences } from "../api/types";

export type ResolvedMode = "light" | "dark";

const STORAGE_MODE_KEY = "accuqual-theme-mode"; // the *resolved* mode (light/dark), not the raw "system" preference — see resolveMode

/** "#1a2b3c" -> "H S% L%", the triplet format globals.css's custom properties expect (consumed as hsl(var(--x))). */
function hexToHslTriplet(hex: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return null;
  const int = parseInt(match[1]!, 16);
  const r = ((int >> 16) & 255) / 255;
  const g = ((int >> 8) & 255) / 255;
  const b = (int & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }
    h /= 6;
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Relative luminance (WCAG formula) — used only to pick a legible black/white foreground for a custom color, not a full contrast-ratio check. */
function isLight(hex: string): boolean {
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (!match) return true;
  const int = parseInt(match[1]!, 16);
  const channel = (shift: number) => {
    const c = ((int >> shift) & 255) / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0);
  return luminance > 0.5;
}

/** Legible black/white foreground for a custom color, as an HSL triplet — see the module doc comment on why this exists at all. */
function contrastingForeground(hex: string): string {
  return isLight(hex) ? "216 33% 3%" : "0 0% 100%";
}

/** Resolves "system" against the OS preference; light/dark pass straight through. */
export function resolveMode(mode: UserThemePreferences["mode"] | undefined): ResolvedMode {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark"; // AccuQual's long-standing default — see globals.css's own comment
}

/** Instant-paint hint read before the tenant/user API calls resolve, so the very first frame isn't wrong-then-flips. Best-effort: wrapped for private-browsing/blocked-storage. */
export function getStoredMode(): ResolvedMode | null {
  try {
    const stored = localStorage.getItem(STORAGE_MODE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

/**
 * The one real theme engine entry point: sets the light/dark stamp plus
 * every color CSS custom property globals.css defines, in priority order
 * (user override > tenant theme > built-in default — an unset field at any
 * level just falls through, it's never all-or-nothing). Every existing
 * component already renders through these same tokens (bg-primary,
 * text-foreground, border-border, ...), so this re-themes the whole app
 * without touching a single one of them.
 */
export function applyTheme(branding: TenantBranding | undefined, userPrefs: UserThemePreferences | undefined): ResolvedMode {
  const mode = resolveMode(userPrefs?.mode);
  const root = document.documentElement;

  root.setAttribute("data-theme", mode);
  try {
    localStorage.setItem(STORAGE_MODE_KEY, mode);
  } catch {
    // private browsing / storage blocked — the attribute is already set, that's what actually matters
  }

  // Background/text are the two fields with a real light AND dark variant —
  // everything else (primary, border, ...) is one value that applies in
  // either mode, same as the app's own single dark palette always has been.
  const backgroundHex = mode === "light" ? branding?.backgroundLight : branding?.backgroundDark;
  const textHex = mode === "light" ? branding?.textLight : branding?.textDark;

  const colorVars: Array<[string, string | undefined, boolean?]> = [
    ["--background", backgroundHex],
    ["--foreground", textHex],
    ["--border", branding?.borderColor],
    ["--form-field", branding?.formFieldColor],
    // primary: user override wins over tenant; both get a matching computed foreground.
    ["--primary", userPrefs?.primaryColor ?? branding?.primaryColor, true],
    ["--secondary", branding?.secondaryColor, true],
    ["--accent", userPrefs?.accentColor ?? branding?.accentColor, true],
    ["--button", branding?.buttonColor, true],
  ];

  for (const [cssVar, hex, withForeground] of colorVars) {
    if (!hex) {
      root.style.removeProperty(cssVar);
      if (withForeground) root.style.removeProperty(`${cssVar}-foreground`);
      continue;
    }
    const hsl = hexToHslTriplet(hex);
    if (!hsl) continue; // validated server-side already, but never trust a stored value blindly
    root.style.setProperty(cssVar, hsl);
    if (withForeground) root.style.setProperty(`${cssVar}-foreground`, contrastingForeground(hex));
  }

  return mode;
}
