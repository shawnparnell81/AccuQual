import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { paneOverflowScrolls, treeShouldStick } from "./folderExplorerLayout.ts";

const root = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(root, "../routes/Documents/FolderExplorerPage.tsx"), "utf8");
const css = readFileSync(join(root, "../routes/Documents/folderExplorer.css"), "utf8");

function ruleBodies(source: string, selector: string): string[] {
  const bodies: string[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    if (match[1].includes("@")) continue;
    const selectors = match[1].split(",").map((part) => part.trim().replace(/\s+/g, " "));
    if (selectors.includes(selector)) bodies.push(match[2]);
  }
  return bodies;
}

function overflowDeclarations(source: string, selector: string): string[] {
  const values: string[] = [];
  for (const body of ruleBodies(source, selector)) {
    for (const decl of body.split(";")) {
      const [prop, value] = decl.split(":").map((part) => part.trim());
      if (prop === "overflow" || prop === "overflow-x" || prop === "overflow-y") values.push(value);
    }
  }
  return values;
}

describe("folder explorer layout", () => {
  it("grows the tree and list on the page and keeps the toolbar in reach", () => {
    assert.match(page, /className="folder-explorer"/);
    assert.match(page, /className="folder-explorer-board"/);
    assert.match(page, /data-testid="folder-tree-pane"/);
    assert.match(page, /data-testid="folder-list-pane"/);
    assert.match(page, /className="folder-explorer-pane folder-explorer-tree flex flex-col gap-2 rounded-lg border border-border bg-card p-3"/);
    assert.match(page, /data-testid="explorer-toolbar"/);
    assert.match(page, /folder-explorer-toolbar/);
    assert.match(page, /data-testid="new-folder"/);
    assert.match(page, /data-testid="upload-files"/);
    assert.match(page, /treeShouldStick/);
    assert.match(page, /pageEdgeScroll/);
    assert.match(page, /applyPageScroll/);
    assert.doesNotMatch(page, /paneScrollDelta/);
    assert.doesNotMatch(page, /New folder name…/);
    assert.doesNotMatch(page, /New department…/);
    assert.doesNotMatch(page, /Drag files from your computer/);
    assert.match(page, /folder-explorer-pool/);
    assert.match(page, /dragKind != null && \([\s\S]*data-testid="folder-drop-root"/);
    assert.match(css, /div:has\(> \.page-enter > \.folder-explorer\) \{\s*overflow-x: hidden;\s*overflow-y: auto;\s*padding-top: 0;/);
    assert.match(css, /\.page-enter:has\(> \.folder-explorer\)[\s\S]*height: auto;/);
    assert.match(css, /\.page-enter:has\(> \.folder-explorer\)[\s\S]*max-width: none;/);
    assert.match(css, /\.folder-explorer-toolbar \{[\s\S]*position: sticky;/);
    assert.match(css, /\.folder-explorer-tree\.is-sticky \{[\s\S]*position: sticky;/);
    assert.match(css, /background: hsl\(var\(--background\)\)/);
    assert.doesNotMatch(css, /100vh/);
    assert.doesNotMatch(css, /max-height:\s*\d+vh/);
    assert.doesNotMatch(css, /height:\s*calc\(/);
    assert.doesNotMatch(page, /md:overflow-y-auto/);
    assert.doesNotMatch(page, /h-\[calc\(100vh/);
    assert.doesNotMatch(page, /overflow-y-auto|overflow-auto|overflow-y-scroll|overflow-scroll/);
  });

  it("tree and list panes have no overflow scrolling", () => {
    const panes = [
      ".folder-explorer",
      ".folder-explorer-board",
      ".folder-explorer-pane",
      ".folder-explorer-drop-scroll",
      ".folder-explorer-pool",
      ".folder-explorer-tree",
      ".folder-explorer-toolbar",
    ];
    for (const selector of panes) {
      const values = overflowDeclarations(css, selector);
      for (const value of values) {
        assert.equal(paneOverflowScrolls(value), false, `${selector} ${value}`);
        assert.equal(value.includes("hidden"), false, `${selector} clips`);
      }
    }
    for (const selector of [".folder-explorer-pane", ".folder-explorer-drop-scroll", ".folder-explorer-pool"]) {
      assert.ok(overflowDeclarations(css, selector).includes("visible"), `${selector} stays visible`);
    }
    const scrolling = [...css.matchAll(/overflow(?:-[xy])?\s*:\s*(?:auto|scroll|overlay)/g)].map((match) => match[0]);
    assert.deepEqual(scrolling, ["overflow-y: auto"]);
  });

  it("sticks the tree only when the tree fits under the toolbar", () => {
    assert.equal(treeShouldStick(200, 500, 80), true);
    assert.equal(treeShouldStick(420, 500, 80), true);
    assert.equal(treeShouldStick(430, 500, 80), false);
    assert.equal(treeShouldStick(800, 500, 80), false);
    assert.equal(treeShouldStick(0, 500, 80), false);
    assert.equal(treeShouldStick(100, 80, 80), false);
  });
});
