import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { ncrLayout } from "./layouts/ncr.ts";
import { dimensionalReportLayout } from "./layouts/dimensionalReport.ts";
import { capaLayout } from "./layouts/capa.ts";
import { layoutSignatureBlocks, showsRequiredControl } from "./signatureRequired.ts";

const here = dirname(fileURLToPath(import.meta.url));

describe("signature required control", () => {
  it("shows Required only on a layout with more than one signature block", () => {
    const ncr = layoutSignatureBlocks(ncrLayout);
    const capa = layoutSignatureBlocks(capaLayout);
    const dimensional = layoutSignatureBlocks(dimensionalReportLayout);
    assert.ok(ncr.length > 1);
    assert.equal(showsRequiredControl(ncr.length), true);
    assert.ok(capa.length > 1);
    assert.equal(dimensional.length, 1);
    assert.equal(showsRequiredControl(dimensional.length), false);
  });

  it("keeps Required Yes/No readable and switches without a native radio", () => {
    const stamp = readFileSync(join(here, "SignatureStamp.tsx"), "utf8");
    const choice = stamp.slice(stamp.indexOf("function RequiredChoice"), stamp.indexOf("export function SignatureStamp"));
    const css = readFileSync(join(here, "../../styles/globals.css"), "utf8");
    const rule = css.slice(css.indexOf(".aq-required-choice {"), css.indexOf(".aq-skip"));

    assert.match(choice, /role="radiogroup"/);
    assert.match(choice, /Yes/);
    assert.match(choice, /No/);
    assert.match(choice, /onChange\(next\)/);
    assert.match(choice, /className="aq-required-choice"/);
    assert.doesNotMatch(choice, /type="radio"/);
    assert.doesNotMatch(choice, /text-foreground/);
    assert.match(stamp, /setChoiceDraft\(next\)/);
    assert.match(stamp, /disabled=\{requirement\.disabled\}/);
    assert.doesNotMatch(stamp, /requirement\.disabled \|\| disabled/);

    assert.match(rule, /\.aq-required-choice \{[^}]*color:\s*inherit/);
    assert.match(rule, /\[aria-checked="true"\] \.aq-required-mark \{[^}]*background:\s*currentColor/);
    assert.match(rule, /color:\s*inherit/);
    assert.match(choice, /option === "yes" \? "no" : "yes"/);
    assert.match(choice, /onClick=\{\(\) => choose\(option\)\}/);
    assert.doesNotMatch(rule, /hsl\(var\(--foreground\)\)/);
  });

  it("keeps Yes/No at WCAG AA on the dark form tokens and on white paper", () => {
    const css = readFileSync(join(here, "../../styles/globals.css"), "utf8");
    const sheets = [
      readFileSync(join(here, "../../routes/ValidationReports/validationReport.css"), "utf8"),
      readFileSync(join(here, "../../routes/WorkOrders/ProductionWorkOrderTraveler.tsx"), "utf8"),
    ].join("\n");
    const surfaces = [
      cssBlock(css, ":root {"),
      cssBlock(css, ':root[data-theme="dark"]'),
      cssBlock(css, "/* dma-scheme-dark */"),
      cssBlock(css, ':root[data-theme="light"]'),
      cssBlock(css, "/* dma-scheme-light */"),
    ];
    for (const vars of surfaces) {
      assert.ok(contrast(vars["--form-input-foreground"]!, vars["--form-input"]!) >= 4.5);
      assert.ok(contrast(vars["--form-label-foreground"]!, vars["--form-label"]!) >= 4.5);
      const selected = mixOver(vars["--form-input-foreground"]!, vars["--form-input"]!, 0.16);
      assert.ok(contrast(vars["--form-input-foreground"]!, selected) >= 4.5);
    }
    assert.ok(contrast("#111111", "#ffffff") >= 4.5);
    assert.ok(contrast("#1e293b", "#ffffff") >= 4.5);
    assert.match(sheets, /background:\s*#fff/);
    assert.match(sheets, /color:\s*#111/);
    assert.match(sheets, /color:\s*#1e293b/);
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

function parseColor(input: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(input);
  if (hex) {
    const n = Number.parseInt(hex[1]!, 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const match = /^(\d+) (\d+)% (\d+)%$/.exec(input);
  assert.ok(match, input);
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
  const lum = (color: string) => {
    const [r, g, b] = parseColor(color);
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const hi = Math.max(lum(a), lum(b));
  const lo = Math.min(lum(a), lum(b));
  return (hi + 0.05) / (lo + 0.05);
}

/** color-mix(in srgb, currentColor amount, transparent) painted over the cell. */
function mixOver(foreground: string, background: string, amount: number): string {
  const fg = parseColor(foreground);
  const bg = parseColor(background);
  const mixed = fg.map((channel, index) => Math.round(channel * amount + bg[index]! * (1 - amount)));
  return `#${mixed.map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
