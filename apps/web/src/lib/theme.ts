import type { CompanyBranding, UserThemePreferences } from "../api/types";

export type ResolvedMode = "light" | "dark";

/**
 * localStorage keys shared with the blocking script in index.html.
 * That script paints the last resolved mode and palette before the module
 * graph loads; keep the key strings and the managed variable list in sync.
 */
export const THEME_MODE_STORAGE_KEY = "accuqual-theme-mode";
export const THEME_VARS_STORAGE_KEY = "accuqual-theme-vars";

/** Inline custom properties applyTheme owns. Anything not in the derived map is removed so a cleared color falls back to globals.css. */
const MANAGED_THEME_VARS = [
  "--background",
  "--foreground",
  "--card",
  "--muted",
  "--muted-foreground",
  "--border",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--accent",
  "--accent-foreground",
  "--form-field",
  "--button",
  "--button-foreground",
  "--ring",
  "--brand-header",
  "--brand-glow",
] as const;

const MANAGED_THEME_VAR_SET = new Set<string>(MANAGED_THEME_VARS);
const TRIPLET_RE = /^(\d{1,3}) (\d{1,3})% (\d{1,3})%$/;

interface Hsl {
  h: number;
  s: number;
  l: number;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/** "#1a2b3c" only — the same shape the API accepts. Empty and invalid values fall through. */
export function normalizeHex(hex: string | undefined | null): string | null {
  if (!hex) return null;
  const match = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  return match ? `#${match[1]!.toLowerCase()}` : null;
}

function firstHex(...candidates: Array<string | undefined | null>): string | null {
  for (const candidate of candidates) {
    const hex = normalizeHex(candidate);
    if (hex) return hex;
  }
  return null;
}

function parseHex(hex: string): Hsl | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const int = parseInt(normalized.slice(1), 16);
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
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function formatHsl({ h, s, l }: Hsl): string {
  const hue = ((Math.round(h) % 360) + 360) % 360;
  return `${hue} ${clamp(Math.round(s), 0, 100)}% ${clamp(Math.round(l), 0, 100)}%`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

/** Relative luminance (WCAG). Used only to pick black or white text on a filled control. */
function relativeLuminance({ h, s, l }: Hsl): number {
  const [r, g, b] = hslToRgb(h, s / 100, l / 100);
  const channel = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(a: number, b: number): number {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/** Whichever of near-black or white actually contrasts with the fill. A bright cyan can sit under luminance 0.5 and still fail with white text. */
function contrastingForeground(hsl: Hsl): string {
  const lum = relativeLuminance(hsl);
  const darkLum = relativeLuminance({ h: 216, s: 33, l: 3 });
  const whiteContrast = contrastRatio(lum, 1);
  const darkContrast = contrastRatio(lum, darkLum);
  return whiteContrast >= darkContrast ? "0 0% 100%" : "216 33% 3%";
}

/**
 * One stored hex has to read on both the dark canvas and the light one.
 * Hue and saturation stay put; lightness is pulled into the band that
 * already matches globals.css (neon-on-dark, deepened-on-light). A value
 * already inside that band is left alone, so #0891b2 stays #0891b2 in
 * light mode. Neon picks are deepened further so link text and white
 * button labels stay readable on the pale derived surfaces.
 */
function toneBrand(seed: Hsl, mode: ResolvedMode): Hsl {
  if (seed.s < 12) {
    return {
      h: seed.h,
      s: seed.s,
      l: mode === "dark" ? clamp(seed.l, 72, 90) : clamp(seed.l, 16, 32),
    };
  }
  if (mode === "dark") {
    return { h: seed.h, s: seed.s, l: clamp(seed.l, 48, 62) };
  }
  if (Math.round(seed.l) > 36) {
    return { h: seed.h, s: seed.s, l: 24 };
  }
  return { h: seed.h, s: seed.s, l: clamp(seed.l, 24, 36) };
}

/** Page, card, text, and border tints. Chromatic seeds get the same relationship as the built-in cyan palette; near-grays stay neutral so a white pick does not invent a hue. */
function deriveSurfaces(seed: Hsl, mode: ResolvedMode): Record<string, string> {
  const h = seed.h;
  const neutral = seed.s < 12;
  const sat = (colorful: number) => (neutral ? Math.min(seed.s, 10) : colorful);
  if (mode === "dark") {
    return {
      "--background": formatHsl({ h, s: sat(32), l: 6 }),
      "--foreground": formatHsl({ h, s: sat(15), l: 97 }),
      "--card": formatHsl({ h, s: sat(28), l: 11 }),
      "--muted": formatHsl({ h, s: sat(26), l: 17 }),
      "--muted-foreground": formatHsl({ h, s: sat(16), l: 68 }),
      "--border": formatHsl({ h, s: sat(24), l: 22 }),
      "--brand-header": formatHsl({ h, s: sat(30), l: 4 }),
    };
  }
  return {
    "--background": formatHsl({ h, s: sat(58), l: 88 }),
    "--foreground": formatHsl({ h, s: sat(28), l: 10 }),
    "--card": formatHsl({ h, s: sat(62), l: 94 }),
    "--muted": formatHsl({ h, s: sat(52), l: 84 }),
    "--muted-foreground": formatHsl({ h, s: sat(22), l: 34 }),
    "--border": formatHsl({ h, s: sat(42), l: 74 }),
    "--brand-header": formatHsl({ h, s: sat(30), l: 12 }),
  };
}

function assignExact(vars: Record<string, string>, cssVar: string, hex: string | undefined, withForeground = false) {
  const normalized = normalizeHex(hex);
  if (!normalized) return;
  const hsl = parseHex(normalized);
  if (!hsl) return;
  vars[cssVar] = formatHsl(hsl);
  if (withForeground) vars[`${cssVar}-foreground`] = contrastingForeground(hsl);
}

export interface DerivedThemeInput {
  mode: ResolvedMode;
  branding?: CompanyBranding;
  userPrefs?: UserThemePreferences;
}

/**
 * CSS custom properties for one mode. User primary/accent win over the
 * organization, matching Settings → Theme. When a primary is present, the
 * unset surface tokens (background, card, text, border, ring, glow) are
 * derived from its hue for this mode. Explicit organization fields
 * (backgroundLight/Dark, text, border, form field, secondary, button)
 * still replace the derived value. No primary and no explicit fields
 * returns an empty map so globals.css keeps the built-in palette.
 */
export function deriveThemeVars({ mode, branding, userPrefs }: DerivedThemeInput): Record<string, string> {
  const vars: Record<string, string> = {};
  const primaryHex = firstHex(userPrefs?.primaryColor, branding?.primaryColor);
  const accentHex = firstHex(userPrefs?.accentColor, branding?.accentColor);

  if (primaryHex) {
    const seed = parseHex(primaryHex);
    if (seed) {
      const primary = toneBrand(seed, mode);
      Object.assign(vars, deriveSurfaces(seed, mode));
      vars["--primary"] = formatHsl(primary);
      vars["--primary-foreground"] = contrastingForeground(primary);
      vars["--ring"] = formatHsl(primary);
      vars["--brand-glow"] = formatHsl(primary);
    }
  }

  if (accentHex) {
    const seed = parseHex(accentHex);
    if (seed) {
      const accent = toneBrand(seed, mode);
      vars["--accent"] = formatHsl(accent);
      vars["--accent-foreground"] = contrastingForeground(accent);
    }
  }

  const backgroundHex = mode === "light" ? branding?.backgroundLight : branding?.backgroundDark;
  const textHex = mode === "light" ? branding?.textLight : branding?.textDark;
  assignExact(vars, "--background", backgroundHex);
  assignExact(vars, "--foreground", textHex);
  assignExact(vars, "--border", branding?.borderColor);
  assignExact(vars, "--form-field", branding?.formFieldColor);
  assignExact(vars, "--secondary", branding?.secondaryColor, true);
  assignExact(vars, "--button", branding?.buttonColor, true);

  return vars;
}

/** Resolves "system" against the OS preference; light/dark pass straight through. */
export function resolveMode(mode: UserThemePreferences["mode"] | undefined): ResolvedMode {
  if (mode === "light" || mode === "dark") return mode;
  if (typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: light)").matches) return "light";
  return "dark"; // AccuQual's long-standing default — see globals.css's own comment
}

/** Instant-paint hint read before the company/user API calls resolve, so the very first frame isn't wrong-then-flips. Best-effort: wrapped for private-browsing/blocked-storage. */
export function getStoredMode(): ResolvedMode | null {
  try {
    const stored = localStorage.getItem(THEME_MODE_STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function readStoredVars(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(THEME_VARS_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const vars: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (!MANAGED_THEME_VAR_SET.has(key) || typeof value !== "string") continue;
      const match = TRIPLET_RE.exec(value);
      if (!match) continue;
      if (Number(match[1]) > 360 || Number(match[2]) > 100 || Number(match[3]) > 100) continue;
      vars[key] = value;
    }
    return vars;
  } catch {
    return null;
  }
}

/**
 * Reapplies the last derived palette before React mounts. index.html does
 * the same thing even earlier; this covers a session where that script
 * did not run. Invalid stored values are ignored.
 */
export function applyStoredThemeVars(): void {
  const vars = readStoredVars();
  if (!vars) return;
  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

function persistVars(vars: Record<string, string>) {
  try {
    localStorage.setItem(THEME_VARS_STORAGE_KEY, JSON.stringify(vars));
  } catch {
    // private browsing / storage blocked — the inline properties are already set
  }
}

/**
 * The one real theme engine entry point: sets the light/dark stamp plus
 * every color CSS custom property globals.css defines, in priority order
 * (user override > derived palette > explicit company field > built-in
 * default). Light and dark are chosen only from the mode preference —
 * a color never flips the mode. Every existing component already renders
 * through these tokens (bg-primary, text-foreground, border-border, ...).
 */
export function applyTheme(branding: CompanyBranding | undefined, userPrefs: UserThemePreferences | undefined): ResolvedMode {
  const mode = resolveMode(userPrefs?.mode);
  const root = document.documentElement;

  root.setAttribute("data-theme", mode);
  try {
    localStorage.setItem(THEME_MODE_STORAGE_KEY, mode);
  } catch {
    // private browsing / storage blocked — the attribute is already set, that's what actually matters
  }

  const vars = deriveThemeVars({ mode, branding, userPrefs });
  for (const cssVar of MANAGED_THEME_VARS) {
    const value = vars[cssVar];
    if (value) root.style.setProperty(cssVar, value);
    else root.style.removeProperty(cssVar);
  }
  persistVars(vars);
  return mode;
}
