import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentsFolderHref, filingLocation, folderChain, listFolder, openTarget, type BrowseFolder } from "./folderBrowse.ts";

const tree: BrowseFolder[] = [
  { id: 1, name: "Quality", parentId: null, sortOrder: 0 },
  { id: 2, name: "Production & Inspection", parentId: 1, sortOrder: 0 },
  { id: 3, name: "Empty drawer", parentId: 2, sortOrder: 0 },
  {
    id: 4,
    name: "FRM-VAL-001_9_2026-09-30",
    parentId: 2,
    sortOrder: 1,
    linkedPath: "/validation-reports/9",
  },
  { id: 5, name: "Procedure.pdf", parentId: 2, sortOrder: 2, pdfPath: "files/procedure.pdf" },
];

describe("folder browse", () => {
  it("builds a breadcrumb chain and a folder link", () => {
    assert.deepEqual(
      folderChain(tree, 4).map((folder) => folder.name),
      ["Quality", "Production & Inspection", "FRM-VAL-001_9_2026-09-30"],
    );
    assert.equal(documentsFolderHref(2), "/documents/folders?folder=2");
  });

  it("lists subfolders separately from a saved form you can open", () => {
    const listing = listFolder(tree, 2);
    assert.deepEqual(
      listing.folders.map((folder) => folder.name),
      ["Empty drawer"],
    );
    assert.deepEqual(
      listing.files.map((file) => file.name),
      ["FRM-VAL-001_9_2026-09-30", "Procedure.pdf"],
    );
    assert.equal(openTarget(listing.files[0]!), "/validation-reports/9");
    assert.equal(openTarget(listing.files[1]!), null);
    assert.equal(openTarget({ id: 8, name: "Spec", parentId: 2, sortOrder: 0, documentId: 15 }), "/documents/15");
  });

  it("turns a filing into the folder the save message links to", () => {
    assert.deepEqual(filingLocation(2, ["Quality", "Production & Inspection"], "FRM-VAL-001_9_2026-09-30"), {
      path: "Quality / Production & Inspection",
      folderId: 2,
      fileName: "FRM-VAL-001_9_2026-09-30",
    });
    assert.equal(filingLocation(null, [], null), null);
    assert.equal(documentsFolderHref(2), "/documents/folders?folder=2");
  });
});
