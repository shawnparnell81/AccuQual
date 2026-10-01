import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { departmentForFolder, documentsFolderHref, filingLocation, folderChain, leftHandFolders, listFolder, openTarget, saveAsFolders, visibleExplorerFolders, type BrowseFolder } from "./folderBrowse.ts";

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

  it("shows a saved FRM NCR and keeps empty blanks out of Folder Explorer", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "Quality", parentId: null, sortOrder: 0 },
      { id: 2, name: "Records", parentId: 1, sortOrder: 0 },
      { id: 3, name: "NCR Records", parentId: 2, sortOrder: 0 },
      { id: 4, name: "FRM-NCR-001_4_2026-10-01", parentId: 3, sortOrder: 0, linkedPath: "/iso-forms/record/4" },
      { id: 5, name: "FRM-VAL-001_9_2026-09-30", parentId: 2, sortOrder: 1, linkedPath: "/validation-reports/9" },
      { id: 6, name: "Forms & Templates", parentId: 1, sortOrder: 1 },
      { id: 7, name: "NCR Form", parentId: 6, sortOrder: 0, linkedPath: "/ncr" },
      { id: 8, name: "8D Form", parentId: 6, sortOrder: 1, linkedPath: "/8d" },
      { id: 10, name: "ISO Compliance Documents", parentId: null, sortOrder: 1 },
      { id: 11, name: "Blank Form Templates", parentId: 10, sortOrder: 0 },
      { id: 12, name: "Nonconformance", parentId: 11, sortOrder: 0 },
    ];
    const names = visibleExplorerFolders(rows).map((folder) => folder.name);
    assert.equal(names.includes("FRM-NCR-001_4_2026-10-01"), true);
    assert.equal(names.includes("FRM-VAL-001_9_2026-09-30"), true);
    assert.equal(names.includes("NCR Form"), false);
    assert.equal(names.includes("8D Form"), false);
    assert.equal(names.includes("Blank Form Templates"), false);
    assert.equal(names.includes("Nonconformance"), false);
    const saved = listFolder(visibleExplorerFolders(rows), 3).files;
    assert.equal(openTarget(saved[0]!), "/iso-forms/record/4");
    assert.equal(openTarget(rows.find((folder) => folder.id === 5)!), "/validation-reports/9");
  });

  it("keeps departments on the left-hand list under ISO Compliance Documents", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null, sortOrder: 0 },
      { id: 2, name: "Engineering", parentId: 1, sortOrder: 0 },
      { id: 3, name: "Quality", parentId: 1, sortOrder: 1 },
      { id: 4, name: "Audits", parentId: 1, sortOrder: 2 },
      { id: 5, name: "Training", parentId: 1, sortOrder: 3 },
      { id: 6, name: "Safety", parentId: 1, sortOrder: 4 },
      { id: 7, name: "Production", parentId: 1, sortOrder: 5 },
      { id: 8, name: "CAPA", parentId: 1, sortOrder: 6 },
      { id: 9, name: "NCR", parentId: 1, sortOrder: 7 },
      { id: 10, name: "8D", parentId: 1, sortOrder: 8 },
      { id: 11, name: "SOP", parentId: 1, sortOrder: 11 },
      { id: 12, name: "Policies", parentId: 11, sortOrder: 0 },
      { id: 13, name: "Procedures", parentId: 11, sortOrder: 1 },
      { id: 14, name: "Library Pool", parentId: null, sortOrder: 1 },
      { id: 15, name: "CSA", parentId: 2, sortOrder: 0 },
    ];
    assert.deepEqual(
      leftHandFolders(rows).map((folder) => folder.name),
      ["Engineering", "Quality", "Audits", "Training", "Safety", "Production", "CAPA", "NCR", "8D", "SOP"],
    );
    assert.equal(departmentForFolder(rows, 15)?.name, "Engineering");
    assert.equal(departmentForFolder(rows, 12)?.name, "SOP");
    assert.equal(departmentForFolder(rows, 1)?.name, "ISO Compliance Documents");
  });
});
