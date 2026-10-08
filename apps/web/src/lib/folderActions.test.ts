import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultRetireDestinationId, documentFolderHasContents, folderPathLabel, isBlankLibraryFolder, retireDestinationChoices, subtreeIds } from "./folderActions.ts";
import type { BrowseFolder } from "./folderBrowse.ts";

function row(id: number, name: string, parentId: number | null, extra: Partial<BrowseFolder> = {}): BrowseFolder {
  return { id, name, parentId, sortOrder: id, pdfPath: null, linkedPath: null, documentId: null, ...extra };
}

describe("folder edit and delete helpers", () => {
  const folders = [
    row(1, "ISO Compliance Documents", null),
    row(2, "Safety", 1),
    row(3, "Safety Procedures", 2),
    row(4, "Training", 1),
    row(5, "Blank Forms Templates", 1),
    row(6, "Change Control", 5),
    row(7, "Library Pool", null),
  ];

  it("builds the copyable path and defaults a delete to the parent", () => {
    assert.equal(folderPathLabel(["Documents", "ISO Compliance Documents", "Safety"]), "Documents / ISO Compliance Documents / Safety");
    assert.equal(defaultRetireDestinationId(folders, 2), 1);
    assert.equal(defaultRetireDestinationId(folders, 1), null);
    assert.deepEqual([...subtreeIds(folders, 2)].sort(), [2, 3]);
  });

  it("offers every other folder, including the older department folders, and skips the blank drawer", () => {
    const choices = retireDestinationChoices(folders, 2).map((folder) => folder.name);
    assert.deepEqual(choices, ["ISO Compliance Documents", "Training", "Blank Forms Templates", "Change Control"]);
    assert.equal(documentFolderHasContents(folders[1]!, folders), true);
    assert.equal(documentFolderHasContents(folders[3]!, folders), false);
    assert.equal(isBlankLibraryFolder(folders, 6), true);
    assert.equal(isBlankLibraryFolder(folders, 4), false);
  });
});
