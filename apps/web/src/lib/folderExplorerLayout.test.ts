import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

const root = dirname(fileURLToPath(import.meta.url));
const page = readFileSync(join(root, "../routes/Documents/FolderExplorerPage.tsx"), "utf8");
const css = readFileSync(join(root, "../routes/Documents/folderExplorer.css"), "utf8");

describe("folder explorer layout", () => {
  it("fills the workspace and scrolls only the panes", () => {
    assert.match(page, /className="folder-explorer"/);
    assert.match(page, /className="folder-explorer-board"/);
    assert.match(page, /className="folder-explorer-pane flex flex-col gap-2 rounded-lg border border-border bg-card p-3"/);
    assert.match(page, /data-testid="explorer-toolbar"/);
    assert.match(page, /data-testid="new-folder"/);
    assert.match(page, /data-testid="upload-files"/);
    assert.doesNotMatch(page, /New folder name…/);
    assert.doesNotMatch(page, /New department…/);
    assert.doesNotMatch(page, /Drag files from your computer/);
    assert.match(page, /folder-explorer-pool/);
    assert.match(css, /div:has\(> \.page-enter > \.folder-explorer\) \{\s*overflow: hidden;/);
    assert.match(css, /\.page-enter:has\(> \.folder-explorer\)[\s\S]*max-width: none;/);
    assert.match(css, /\.folder-explorer-pane \{[\s\S]*overflow-y: auto;/);
    assert.match(css, /\.folder-explorer-board \{[\s\S]*overflow: hidden;/);
    assert.match(css, /background: hsl\(var\(--background\)\)/);
    assert.doesNotMatch(css, /100vh/);
    assert.doesNotMatch(css, /max-height:\s*\d+vh/);
    assert.doesNotMatch(page, /md:overflow-y-auto/);
    assert.doesNotMatch(page, /h-\[calc\(100vh/);
  });
});
