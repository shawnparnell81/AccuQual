import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const srcRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else if (path.endsWith(".tsx")) out.push(path);
  }
  return out;
}

describe("theme contrast", () => {
  it("does not use hard-coded white or black text classes on theme-colored surfaces", () => {
    const failures: string[] = [];
    for (const file of walk(srcRoot)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const stripped = line.replace(/print:text-white/g, "").replace(/print:text-black/g, "");
        if (/\btext-white\b/.test(stripped) && !line.includes("brand-header")) {
          failures.push(`${file}:${index + 1}: ${line.trim()}`);
        }
        if (/\btext-black\b/.test(stripped)) {
          failures.push(`${file}:${index + 1}: ${line.trim()}`);
        }
        if (/text-slate-\d+/.test(line) && !/dark:text-slate-\d+/.test(line)) {
          failures.push(`${file}:${index + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepEqual(failures, []);
  });

  it("prints on light paper with dark type and keeps menus off the header color", () => {
    const css = readFileSync(join(srcRoot, "styles/globals.css"), "utf8");
    const printAt = css.indexOf("@media print {");
    assert.ok(printAt > 0);
    const printCss = css.slice(printAt, css.indexOf("@media (prefers-reduced-motion", printAt));
    assert.match(printCss, /color-scheme:\s*light\s*!important/);
    assert.match(printCss, /--form-input-foreground:\s*222 28% 8%\s*!important/);
    assert.match(printCss, /@page wide-sheet \{\s*size:\s*letter landscape/);
    assert.match(printCss, /\.validation-report-print,\s*\.aq-print-wide \{\s*page:\s*wide-sheet/);
    assert.doesNotMatch(printCss, /\.text-white\s*\{[^}]*#fff/);
    assert.match(css, /\.aq-menu \{\s*color:\s*hsl\(var\(--foreground\)\)/);
    assert.match(css, /body input:where\(:not\(\[type="checkbox"\]\)/);
  });

  it("lets workbook cells keep the color they set on a status fill", () => {
    const css = readFileSync(join(srcRoot, "routes/ValidationReports/validationReport.css"), "utf8");
    assert.match(css, /\.csa input\.csa-in[\s\S]*?color:\s*inherit/);
    assert.match(css, /\.fp input\.fp-in[\s\S]*?color:\s*inherit/);
    assert.match(css, /\.csa \.section \{\s*background:\s*var\(--form-bar/);
    assert.match(css, /color:\s*var\(--form-bar-foreground/);
  });
});
