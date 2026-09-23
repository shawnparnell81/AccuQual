import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  THEME_MODE_STORAGE_KEY,
  THEME_VARS_STORAGE_KEY,
  applyStoredThemeVars,
  applyTheme,
  deriveThemeVars,
  normalizeHex,
  resolveMode,
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
});
