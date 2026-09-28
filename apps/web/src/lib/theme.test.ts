import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { readFileSync } from "node:fs";
import {
  THEME_MODE_STORAGE_KEY,
  THEME_SCHEME_STORAGE_KEY,
  THEME_VARS_STORAGE_KEY,
  applyStoredThemeVars,
  applyTheme,
  deriveThemeVars,
  getStoredScheme,
  normalizeHex,
  resolveMode,
  resolveScheme,
} from "./theme.ts";

function lightness(triplet: string | undefined): number {
  assert.ok(triplet, "expected a color triplet");
  const match = /^(\d+) (\d+)% (\d+)%$/.exec(triplet);
  assert.ok(match, `not a triplet: ${triplet}`);
  return Number(match[3]);
}

function hue(triplet: string | undefined): number {
  assert.ok(triplet);
  const match = /^(\d+) /.exec(triplet);
  assert.ok(match);
  return Number(match[1]);
}

function saturation(triplet: string | undefined): number {
  assert.ok(triplet);
  const match = /^\d+ (\d+)%/.exec(triplet);
  assert.ok(match);
  return Number(match[1]);
}

describe("deriveThemeVars", () => {
  it("leaves the built-in palette alone when nothing is customized", () => {
    assert.deepEqual(deriveThemeVars({ mode: "dark" }), {});
    assert.deepEqual(deriveThemeVars({ mode: "light", userPrefs: { primaryColor: "" } }), {});
  });

  it("derives surfaces from primary and keeps light and dark as separate lightness bands", () => {
    const dark = deriveThemeVars({ mode: "dark", userPrefs: { primaryColor: "#00F3FF" } });
    const light = deriveThemeVars({ mode: "light", userPrefs: { primaryColor: "#00f3ff" } });

    assert.equal(hue(dark["--primary"]), hue(light["--primary"]));
    assert.equal(hue(dark["--background"]), hue(dark["--primary"]));
    assert.ok(lightness(dark["--primary"]) >= 48 && lightness(dark["--primary"]) <= 62);
    assert.ok(lightness(light["--primary"]) >= 24 && lightness(light["--primary"]) <= 36);
    assert.ok(lightness(dark["--background"]) < 15);
    assert.ok(lightness(light["--background"]) > 80);
    assert.ok(lightness(light["--card"]) > lightness(light["--background"]));
    assert.ok(lightness(dark["--card"]) > lightness(dark["--background"]));
    assert.ok(lightness(dark["--foreground"]) > 90);
    assert.ok(lightness(light["--foreground"]) < 20);
    assert.equal(dark["--ring"], dark["--primary"]);
    assert.equal(dark["--brand-glow"], dark["--primary"]);
    assert.equal(dark["--accent"], undefined);
  });

  it("does not invent a hue for a neutral primary", () => {
    const vars = deriveThemeVars({ mode: "dark", userPrefs: { primaryColor: "#ffffff" } });
    assert.equal(saturation(vars["--primary"]), 0);
    assert.equal(saturation(vars["--background"]), 0);
    assert.ok(lightness(vars["--primary"]) >= 72);
  });

  it("keeps an already-legible light-mode cyan instead of re-toning it", () => {
    const vars = deriveThemeVars({ mode: "light", userPrefs: { primaryColor: "#0891b2" } });
    assert.equal(vars["--primary"], "192 91% 36%");
  });

  it("uses accent without recoloring the page when primary is unset", () => {
    const vars = deriveThemeVars({ mode: "dark", userPrefs: { accentColor: "#a855f7" } });
    assert.ok(vars["--accent"]);
    assert.ok(vars["--accent-foreground"]);
    assert.equal(vars["--background"], undefined);
    assert.equal(vars["--primary"], undefined);
    assert.notEqual(hue(vars["--accent"]), 183);
  });

  it("lets a user primary beat the organization, and an explicit background beat the derivation", () => {
    const vars = deriveThemeVars({
      mode: "light",
      branding: { primaryColor: "#22c55e", backgroundLight: "#112233", borderColor: "#abcdef" },
      userPrefs: { primaryColor: "#00f3ff", accentColor: "#a855f7" },
    });
    assert.equal(hue(vars["--primary"]), hue(deriveThemeVars({ mode: "light", userPrefs: { primaryColor: "#00f3ff" } })["--primary"]));
    assert.notEqual(hue(vars["--background"]), hue(vars["--primary"]));
    assert.equal(vars["--background"], "210 50% 13%");
    assert.equal(vars["--border"], "210 68% 80%");
    assert.ok(vars["--accent"]);
    assert.notEqual(hue(vars["--accent"]), hue(vars["--primary"]));
  });

  it("ignores invalid hex instead of writing a broken custom property", () => {
    assert.equal(normalizeHex("#abc"), null);
    assert.equal(normalizeHex("red"), null);
    const vars = deriveThemeVars({ mode: "dark", userPrefs: { primaryColor: "not-a-color", accentColor: "#12" } });
    assert.deepEqual(vars, {});
  });
});

describe("resolveMode", () => {
  it("passes light and dark through and defaults to dark without a window", () => {
    assert.equal(resolveMode("light"), "light");
    assert.equal(resolveMode("dark"), "dark");
    assert.equal(resolveMode("system"), "dark");
    assert.equal(resolveMode(undefined), "dark");
  });
});

describe("applyTheme", () => {
  const style = new Map<string, string>();
  const attrs = new Map<string, string>();
  const store = new Map<string, string>();

  const originalDocument = globalThis.document;
  const originalStorage = globalThis.localStorage;

  function installDom() {
    style.clear();
    attrs.clear();
    store.clear();
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        documentElement: {
          setAttribute: (key: string, value: string) => attrs.set(key, value),
          getAttribute: (key: string) => attrs.get(key) ?? null,
          style: {
            setProperty: (key: string, value: string) => style.set(key, value),
            removeProperty: (key: string) => style.delete(key),
          },
        },
      },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => store.set(key, value),
        removeItem: (key: string) => store.delete(key),
      },
    });
  }

  afterEach(() => {
    Object.defineProperty(globalThis, "document", { configurable: true, value: originalDocument });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  });

  it("stamps the requested mode even when the color is the other mode's neon", () => {
    installDom();
    const mode = applyTheme(undefined, { mode: "light", primaryColor: "#00f3ff" });
    assert.equal(mode, "light");
    assert.equal(attrs.get("data-theme"), "light");
    assert.equal(store.get(THEME_MODE_STORAGE_KEY), "light");
    assert.ok(style.get("--background"));
    assert.equal(style.get("--primary"), deriveThemeVars({ mode: "light", userPrefs: { primaryColor: "#00f3ff" } })["--primary"]);
  });

  it("clears derived properties when the override is removed, and restores them from storage", () => {
    installDom();
    applyTheme(undefined, { mode: "dark", primaryColor: "#e11d48", accentColor: "#a855f7" });
    assert.ok(style.get("--card"));
    assert.ok(style.get("--accent"));

    applyTheme(undefined, { mode: "dark", primaryColor: "", accentColor: "" });
    assert.equal(style.get("--card"), undefined);
    assert.equal(style.get("--accent"), undefined);
    assert.equal(store.get(THEME_VARS_STORAGE_KEY), "{}");

    applyTheme(undefined, { mode: "dark", primaryColor: "#e11d48" });
    const saved = store.get(THEME_VARS_STORAGE_KEY);
    style.clear();
    applyStoredThemeVars();
    assert.equal(style.get("--primary"), JSON.parse(saved ?? "{}")["--primary"]);
    assert.equal(style.get("--accent"), undefined);
  });

  it("ignores a stored palette that is not a color triplet", () => {
    installDom();
    store.set(THEME_VARS_STORAGE_KEY, JSON.stringify({ "--background": "red; background: url(https://evil)", "--primary": "183 100% 50%" }));
    applyStoredThemeVars();
    assert.equal(style.get("--background"), undefined);
    assert.equal(style.get("--primary"), "183 100% 50%");
  });

  it("persists DMA Industries independently of light and dark, and restores Classic colors", () => {
    installDom();
    applyTheme(undefined, { mode: "dark", scheme: "classic", primaryColor: "#00f3ff" });
    const classicVars = store.get(THEME_VARS_STORAGE_KEY);
    assert.equal(attrs.get("data-scheme"), "classic");
    assert.ok(style.get("--primary"));

    applyTheme(undefined, { mode: "light", scheme: "dma", primaryColor: "#00f3ff" });
    assert.equal(attrs.get("data-scheme"), "dma");
    assert.equal(attrs.get("data-theme"), "light");
    assert.equal(store.get(THEME_SCHEME_STORAGE_KEY), "dma");
    assert.equal(store.get(THEME_MODE_STORAGE_KEY), "light");
    assert.equal(style.get("--primary"), undefined);
    assert.equal(style.get("--background"), undefined);
    assert.equal(store.get(THEME_VARS_STORAGE_KEY), classicVars);

    style.clear();
    applyStoredThemeVars();
    assert.equal(style.get("--primary"), undefined);

    applyTheme(undefined, { mode: "dark", scheme: "classic", primaryColor: "#00f3ff" });
    assert.equal(attrs.get("data-scheme"), "classic");
    assert.equal(attrs.get("data-theme"), "dark");
    assert.equal(store.get(THEME_SCHEME_STORAGE_KEY), "classic");
    assert.equal(style.get("--primary"), JSON.parse(store.get(THEME_VARS_STORAGE_KEY) ?? "{}")["--primary"]);
  });

  it("keeps a stored scheme when the profile has not saved one yet, and ignores junk", () => {
    installDom();
    store.set(THEME_SCHEME_STORAGE_KEY, "dma");
    assert.equal(getStoredScheme(), "dma");
    assert.equal(resolveScheme(undefined), "dma");
    applyTheme(undefined, { mode: "dark" });
    assert.equal(attrs.get("data-scheme"), "dma");

    store.set(THEME_SCHEME_STORAGE_KEY, "nope");
    assert.equal(getStoredScheme(), null);
    assert.equal(resolveScheme(undefined), "classic");
    assert.equal(resolveScheme("classic"), "classic");
  });
});

function cssBlock(css: string, marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, marker);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const line of css.slice(open + 1, close).split("\n")) {
    const match = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (match) vars[match[1]!] = match[2]!.trim();
  }
  return vars;
}

function channel(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function tripletRgb(triplet: string): [number, number, number] {
  const match = /^(\d+) (\d+)% (\d+)%$/.exec(triplet);
  assert.ok(match, triplet);
  const h = Number(match[1]) / 360;
  const s = Number(match[2]) / 100;
  const l = Number(match[3]) / 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function contrast(a: string, b: string): number {
  const lum = (triplet: string) => {
    const [r, g, b] = tripletRgb(triplet);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const hi = Math.max(lum(a), lum(b));
  const lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
}

describe("DMA Industries palette", () => {
  const css = readFileSync(new URL("../styles/globals.css", import.meta.url), "utf8");
  const html = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

  it("leaves the Classic primary triplets in place", () => {
    assert.match(css, /--primary:\s*183 100% 50%/);
    assert.match(css, /--primary:\s*192 91% 36%/);
    assert.match(css, /--form-heading:\s*#1d3a5c/);
    assert.match(css, /--chart-critical:\s*#e11d48/);
  });

  it("paints the scheme before the bundle loads", () => {
    assert.match(html, /accuqual-color-scheme/);
    assert.match(html, /data-scheme/);
    assert.match(html, /scheme === "dma"/);
  });

  for (const marker of ["/* dma-scheme-dark */", "/* dma-scheme-light */"]) {
    it(`keeps text at WCAG AA in ${marker}`, () => {
      const vars = cssBlock(css, marker);
      const pairs: Array<[string, string]> = [
        ["--foreground", "--background"],
        ["--muted-foreground", "--background"],
        ["--muted-foreground", "--muted"],
        ["--primary", "--background"],
        ["--primary-foreground", "--primary"],
        ["--accent", "--background"],
        ["--accent-foreground", "--accent"],
        ["--button-foreground", "--button"],
        ["--success", "--background"],
        ["--success-foreground", "--success"],
        ["--warning", "--background"],
        ["--warning-foreground", "--warning"],
        ["--destructive", "--background"],
        ["--destructive-foreground", "--destructive"],
        ["--info", "--background"],
        ["--info-foreground", "--info"],
      ];
      for (const [fg, bg] of pairs) {
        assert.ok(vars[fg] && vars[bg], `${marker} missing ${fg} or ${bg}`);
        const ratio = contrast(vars[fg]!, vars[bg]!);
        assert.ok(ratio >= 4.5, `${marker} ${fg} on ${bg} is ${ratio.toFixed(2)}`);
      }
      const successHue = Number(vars["--success"]!.split(" ")[0]);
      const warningHue = Number(vars["--warning"]!.split(" ")[0]);
      const dangerHue = Number(vars["--destructive"]!.split(" ")[0]);
      assert.ok(successHue >= 140 && successHue <= 170, "success stays green");
      assert.ok(warningHue >= 25 && warningHue <= 50, "warning stays amber");
      assert.ok(dangerHue >= 340 || dangerHue <= 15, "destructive stays red");
    });
  }
});
