import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  EXPLORER_VIEWS,
  explorerViewFromKey,
  fileThumbnailKind,
  readExplorerView,
  stepExplorerView,
  storedFileName,
  viewStorageKey,
  writeExplorerView,
} from "./explorerView.ts";

const root = dirname(fileURLToPath(import.meta.url));

function read(relative: string) {
  return readFileSync(join(root, "..", relative), "utf8");
}

describe("explorer view preference", () => {
  it("defaults to list and ignores anything that is not a view", () => {
    const storage = new Map<string, string>();
    const fake = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
    };
    assert.equal(readExplorerView(fake, viewStorageKey("folders", 4)), "list");
    writeExplorerView(fake, viewStorageKey("folders", 4), "large");
    assert.equal(readExplorerView(fake, viewStorageKey("folders", 4)), "large");
    assert.equal(readExplorerView(fake, viewStorageKey("folders", 9)), "list");
    assert.notEqual(viewStorageKey("blank-forms", 4), viewStorageKey("form-folders", 4));
    assert.notEqual(viewStorageKey("form-folders", 4), viewStorageKey("form-folder", 4));
    storage.set(viewStorageKey("folders", 4), "tiles");
    assert.equal(readExplorerView(fake, viewStorageKey("folders", 4)), "list");
    assert.equal(readExplorerView(null, "accuqual-view:folders"), "list");
  });

  it("moves the radiogroup with the arrow keys and wraps", () => {
    assert.deepEqual(EXPLORER_VIEWS, ["list", "details", "small", "large"]);
    assert.equal(stepExplorerView("list", 1), "details");
    assert.equal(stepExplorerView("large", 1), "list");
    assert.equal(stepExplorerView("list", -1), "large");
    assert.equal(explorerViewFromKey("details", "ArrowRight"), "small");
    assert.equal(explorerViewFromKey("details", "ArrowDown"), "small");
    assert.equal(explorerViewFromKey("small", "ArrowLeft"), "details");
    assert.equal(explorerViewFromKey("small", "ArrowUp"), "details");
    assert.equal(explorerViewFromKey("large", "Home"), "list");
    assert.equal(explorerViewFromKey("list", "End"), "large");
    assert.equal(explorerViewFromKey("list", "Enter"), null);
  });

  it("thumbnails an image or a PDF and keeps a type icon for everything else", () => {
    assert.equal(storedFileName("Work instruction", "files/work.pdf"), "Work instruction.pdf");
    assert.equal(storedFileName("photo.png", "files/photo.png"), "photo.png");
    assert.equal(fileThumbnailKind("Work instruction.pdf"), "pdf");
    assert.equal(fileThumbnailKind("photo", "image/png"), "image");
    assert.equal(fileThumbnailKind("notes.docx"), "none");
    assert.equal(fileThumbnailKind("Blank form"), "none");
  });
});

describe("explorer view screens", () => {
  const css = read("components/documents/explorerView.css");
  const list = read("components/documents/FolderContentsList.tsx");
  const switcher = read("components/documents/ExplorerViewSwitcher.tsx");
  const folders = read("routes/Documents/FolderExplorerPage.tsx");
  const blanks = read("routes/BlankForms/BlankFormsPage.tsx");
  const formFolders = read("routes/FormFolders/FormFoldersPage.tsx");

  it("puts a keyboard view switcher on the folder list, blank forms, and both folder pages", () => {
    assert.match(switcher, /role="radiogroup"/);
    assert.match(switcher, /role="radio"/);
    assert.match(switcher, /aria-label=\{option\.label\}/);
    assert.match(switcher, /title=\{option\.label\}/);
    assert.match(switcher, /explorerViewFromKey/);
    assert.match(switcher, /data-testid=\{`explorer-view-\$\{option\.id\}`\}/);
    for (const page of [folders, blanks, formFolders]) {
      assert.match(page, /ExplorerViewSwitcher/);
      assert.match(page, /useExplorerView/);
    }
    assert.match(folders, /useExplorerView\("folders"\)/);
    assert.match(blanks, /useExplorerView\("blank-forms"\)/);
    assert.match(formFolders, /useExplorerView\("form-folders"\)/);
    assert.match(formFolders, /useExplorerView\("form-folder"\)/);
    assert.match(list, /view\?: ExplorerView/);
    assert.match(list, /data-explorer-view="details"/);
    assert.match(list, /data-explorer-view="list"/);
    assert.match(list, /FileThumbnail/);
    assert.match(list, /title=\{item\.label\}/);
    assert.match(blanks, /data-testid="blank-forms-list"/);
    assert.match(blanks, /itemTestId=\{\(\) => "blank-form"\}/);
    assert.match(formFolders, /testId="form-folders-list"/);
    assert.match(formFolders, /testId="saved-fills"/);
    assert.match(formFolders, /itemTestId=\{\(\) => "saved-fill"\}/);
  });

  it("keeps icon grids in the page flow without a scrolling pane", () => {
    assert.match(css, /\.explorer-icons \{[\s\S]*display: grid;/);
    assert.match(css, /\.explorer-icons\[data-explorer-view="small"\]/);
    assert.match(css, /\.explorer-icons\[data-explorer-view="large"\]/);
    assert.doesNotMatch(css, /overflow:\s*(auto|scroll)/);
    assert.doesNotMatch(css, /overflow-[xy]:\s*(auto|scroll)/);
    assert.match(css, /max-height:\s*none/);
    assert.doesNotMatch(css, /max-height:\s*\d+vh/);
    assert.doesNotMatch(list, /overflow-x-auto|overflow-y-auto|overflow-auto/);
    assert.doesNotMatch(blanks, /overflow-x-auto|overflow-y-auto|overflow-auto/);
    assert.doesNotMatch(formFolders, /overflow-x-auto|overflow-y-auto|overflow-auto|overflow-hidden/);
    assert.match(folders, /draggable: canManageFolders/);
    assert.match(folders, /onDragStart:/);
  });
});
