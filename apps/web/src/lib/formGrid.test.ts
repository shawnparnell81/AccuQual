import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { blankCell, cellPaint, inkOnFill, screenCellColors, type FormCell } from "./formGrid.ts";

const here = dirname(fileURLToPath(import.meta.url));

function cssBlock(css: string, marker: string): Record<string, string> {
  const start = css.indexOf(marker);
  assert.ok(start >= 0, marker);
  const open = css.indexOf("{", start);
  const close = css.indexOf("}", open);
  const vars: Record<string, string> = {};
  for (const line of css.slice(open + 1, close).split("\n")) {
    const match = /^\s*(--[\w-]+):\s*([^;]+);/.exec(line);
    if (match?.[1] && match[2]) vars[match[1]] = match[2].trim();
  }
  return vars;
}

function channel(value: number): number {
  const v = value / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function parseColor(input: string): [number, number, number] {
  const hex = /^#([0-9a-f]{6})$/i.exec(input);
  if (hex?.[1]) {
    const n = Number.parseInt(hex[1], 16);
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

function themeInk(marker: string): { background: string; foreground: string } {
  const css = readFileSync(join(here, "../styles/globals.css"), "utf8");
  const vars = cssBlock(css, marker);
  assert.ok(vars["--card"] && vars["--foreground"], marker);
  return { background: vars["--card"]!, foreground: vars["--foreground"]! };
}

function filled(background: string, extra: Partial<FormCell> = {}): FormCell {
  const cell = blankCell();
  cell.style = { ...cell.style, background };
  return { ...cell, ...extra, style: { ...cell.style, ...extra.style } };
}

describe("form builder dark-mode contrast", () => {
  const dark = themeInk(':root[data-theme="dark"]');

  it("keeps default cells and filled cells readable in dark mode without storing new colors", () => {
    const empty = blankCell();
    const before = JSON.stringify(empty);
    const plain = screenCellColors(empty, "", dark);
    assert.equal(plain.background, dark.background);
    assert.equal(plain.color, dark.foreground);
    assert.ok(contrast(plain.color, plain.background) >= 4.5);
    assert.equal(JSON.stringify(empty), before);

    const header = filled("#0A3C7B");
    const headerBefore = JSON.stringify(header);
    const headerInk = screenCellColors(header, "DMA", dark);
    assert.equal(headerInk.background, "#0A3C7B");
    assert.equal(headerInk.color, "#ffffff");
    assert.equal(header.style.color, undefined);
    assert.ok(contrast(headerInk.color, headerInk.background) >= 4.5, `header ${contrast(headerInk.color, headerInk.background)}`);
    assert.equal(JSON.stringify(header), headerBefore);

    const note = filled("#fff2cc");
    const noteInk = screenCellColors(note, "Note", dark);
    assert.equal(noteInk.color, "#111111");
    assert.ok(contrast(noteInk.color, noteInk.background) >= 4.5);

    const passed = filled("", { conditional: true, value: "Pass" });
    passed.style = {};
    const passInk = screenCellColors(passed, "Pass", dark);
    assert.equal(passInk.background, "#4EA72E");
    assert.equal(passInk.color, inkOnFill("#4EA72E"));
    assert.ok(contrast(passInk.color, passInk.background) >= 4.5, `pass ${contrast(passInk.color, passInk.background)}`);

    const failed = blankCell();
    failed.conditional = true;
    const failInk = screenCellColors(failed, "Fail", dark);
    assert.equal(failInk.background, "#FF0000");
    assert.equal(failInk.color, "#111111");
    assert.ok(contrast(failInk.color, failInk.background) >= 4.5, `fail ${contrast(failInk.color, failInk.background)}`);

    const chosen = filled("#0A3C7B", { style: { background: "#0A3C7B", color: "#fff2cc" } });
    assert.equal(cellPaint(chosen, "DMA").color, "#fff2cc");
    assert.equal(chosen.style.color, "#fff2cc");
  });

  it("uses the theme on screen and keeps print and the file viewer on white paper", () => {
    const css = readFileSync(join(here, "../routes/FormBuilder/formBuilder.css"), "utf8");
    const grid = css.slice(css.indexOf(".fb-grid {"), css.indexOf(".fb-grid th,"));
    assert.match(grid, /background:\s*hsl\(var\(--card\)\)/);
    assert.match(grid, /color:\s*hsl\(var\(--foreground\)\)/);
    assert.doesNotMatch(grid, /#fff|#1a1a1a/);
    const bands = css.slice(css.indexOf(".fb-band,"), css.indexOf("@media print"));
    assert.match(bands, /color:\s*hsl\(var\(--foreground\)\)/);
    assert.match(css, /\.fb-sheet \.fb-formula/);
    assert.match(css, /\.fb-sheet \.fb-color/);
    const print = css.slice(css.indexOf("@media print"));
    assert.match(print, /background:\s*#fff/);
    assert.match(print, /color:\s*#1a1a1a/);

    const chrome = readFileSync(join(here, "../routes/FormBuilder/FormChrome.tsx"), "utf8");
    assert.match(chrome, /fb-sheet/);
    assert.doesNotMatch(chrome, /aq-paper/);
    const office = readFileSync(join(here, "../components/shared/officePreview.css"), "utf8");
    assert.match(office, /background:\s*#fff/);
    const preview = readFileSync(join(here, "../components/shared/InAppFilePreview.tsx"), "utf8");
    assert.match(preview, /aq-paper/);

    const light = themeInk(':root[data-theme="light"]');
    const lightInk = screenCellColors(blankCell(), "", light);
    assert.ok(contrast(lightInk.color, lightInk.background) >= 4.5);
  });
});
