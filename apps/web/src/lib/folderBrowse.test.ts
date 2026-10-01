import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentsFolderHref, filingLocation, folderChain, listFolder, openTarget, saveAsFolders, visibleExplorerFolders, type BrowseFolder } from "./folderBrowse.ts";

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

  it("offers Documents folders for Save as and leaves the blank template library out", () => {
    const library: BrowseFolder[] = [
      ...tree,
      { id: 10, name: "ISO Compliance Documents", parentId: null, sortOrder: 1 },
      { id: 11, name: "Blank Form Templates", parentId: 10, sortOrder: 0 },
      { id: 12, name: "Validation", parentId: 11, sortOrder: 0 },
      { id: 13, name: "CSA", parentId: 1, sortOrder: 1 },
      { id: 14, name: "Validation", parentId: 13, sortOrder: 0 },
    ];
    assert.deepEqual(
      saveAsFolders(library).map((folder) => folder.id),
      [1, 2, 3, 10, 13, 14],
    );
  });

  it("keeps a module shortcut as a folder and a saved form as a file", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "Quality", parentId: null, sortOrder: 0 },
      { id: 2, name: "Incoming NCRs", parentId: 1, sortOrder: 0, linkedPath: "/ncr" },
      { id: 3, name: "FRM-VAL-001_9_2026-09-30", parentId: 1, sortOrder: 1, linkedPath: "/validation-reports/9" },
    ];
    const listing = listFolder(rows, 1);
    assert.deepEqual(
      listing.folders.map((folder) => folder.name),
      ["Incoming NCRs"],
    );
    assert.deepEqual(
      listing.files.map((file) => file.name),
      ["FRM-VAL-001_9_2026-09-30"],
    );
    assert.equal(openTarget(listing.folders[0]!), null);
    assert.equal(openTarget(listing.files[0]!), "/validation-reports/9");
  });

  it("shows a cabinet folder as its title plus saved work, and drops empty original blanks", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "Engineering", parentId: null, sortOrder: 0 },
      { id: 2, name: "CSA", parentId: 1, sortOrder: 0 },
      { id: 3, name: "Validation", parentId: 2, sortOrder: 0 },
      { id: 4, name: "Development", parentId: 2, sortOrder: 1 },
      { id: 5, name: "FRM-VAL-001_9_2026-09-30", parentId: 3, sortOrder: 0, linkedPath: "/validation-reports/9" },
      { id: 6, name: "Quality", parentId: null, sortOrder: 1 },
      { id: 7, name: "Forms & Templates", parentId: 6, sortOrder: 0 },
      { id: 8, name: "NCR Form", parentId: 7, sortOrder: 0, linkedPath: "/ncr" },
      { id: 9, name: "8D Form", parentId: 7, sortOrder: 1, linkedPath: "/8d" },
      { id: 15, name: "Kept upload", parentId: 7, sortOrder: 2, pdfPath: "files/kept.pdf" },
      { id: 10, name: "ISO Compliance Documents", parentId: null, sortOrder: 2 },
      { id: 11, name: "Blank Form Templates", parentId: 10, sortOrder: 0 },
      { id: 12, name: "Validation", parentId: 11, sortOrder: 0 },
    ];
    const visible = visibleExplorerFolders(rows);
    const names = visible.map((folder) => folder.name);
    assert.equal(names.includes("NCR Form"), false);
    assert.equal(names.includes("8D Form"), false);
    assert.equal(names.includes("Blank Form Templates"), false);
    assert.equal(names.includes("Forms & Templates"), true);
    assert.equal(names.includes("Kept upload"), true);
    assert.equal(names.includes("Development"), true);

    const csa = listFolder(visible, 2);
    assert.deepEqual(
      csa.folders.map((folder) => folder.name),
      ["Validation", "Development"],
    );
    assert.deepEqual(csa.files, []);
    const validation = listFolder(visible, 3);
    assert.deepEqual(
      validation.folders.map((folder) => folder.name),
      [],
    );
    assert.deepEqual(
      validation.files.map((file) => file.name),
      ["FRM-VAL-001_9_2026-09-30"],
    );
    assert.equal(saveAsFolders(rows).some((folder) => folder.name === "NCR Form" || folder.name === "Blank Form Templates"), false);
    assert.equal(saveAsFolders(rows).some((folder) => folder.id === 3), true);
  });
});
