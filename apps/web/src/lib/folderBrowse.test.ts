import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { blankFormsFolderHref, departmentForFolder, documentsFolderHref, FAI_VALIDATION_FOLDER_NAME, faiValidationDocumentsHref, filingLocation, folderChain, folderIdByName, isBlankTemplateLink, isLivingListPath, LEGACY_VALIDATION_REPORTS_PATH, leftHandFolders, listFolder, openTarget, saveAsFolders, treeOpenForTarget, validationReportsCrumb, visibleExplorerFolders, type BrowseFolder } from "./folderBrowse.ts";

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
    assert.deepEqual(
      folderChain(
        [
          { id: 1, name: "ISO Compliance Documents", parentId: null, sortOrder: 0 },
          { id: 2, name: "Quality", parentId: 1, sortOrder: 0 },
          { id: 3, name: FAI_VALIDATION_FOLDER_NAME, parentId: 2, sortOrder: 0 },
          { id: 4, name: "CSA", parentId: 3, sortOrder: 0 },
        ],
        4,
      ).map((folder) => folder.name),
      ["ISO Compliance Documents", "Quality", FAI_VALIDATION_FOLDER_NAME, "CSA"],
    );
  });

  it("opens the renamed FAI drawer by name and keeps the old Validation Reports address as a redirect target", () => {
    const folders: BrowseFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null, sortOrder: 0 },
      { id: 2, name: "Quality", parentId: 1, sortOrder: 0 },
      { id: 3, name: FAI_VALIDATION_FOLDER_NAME, parentId: 2, sortOrder: 0 },
      { id: 9, name: "Engineering", parentId: 1, sortOrder: 1 },
      { id: 10, name: "Validation", parentId: 9, sortOrder: 0 },
    ];
    assert.equal(folderIdByName(folders, FAI_VALIDATION_FOLDER_NAME), 3);
    assert.equal(folderIdByName(folders, "Validation"), 10);
    assert.equal(faiValidationDocumentsHref(), "/documents/folders?name=FAI%20%2F%20Validation");
    assert.equal(LEGACY_VALIDATION_REPORTS_PATH, "/folders/validation-reports");
    assert.deepEqual(validationReportsCrumb(), { label: "FAI / Validation", to: "/documents/folders?name=FAI%20%2F%20Validation" });
    assert.equal(openTarget({ id: 11, name: "FRM-VAL-001_9", parentId: 3, sortOrder: 0, linkedPath: "/validation-reports/9" }), "/validation-reports/9");
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

  it("shows Blank Forms Templates and treats a blank shortcut as a file that Save as will not use", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null, sortOrder: 0 },
      { id: 2, name: "Blank Forms Templates", parentId: 1, sortOrder: 3 },
      { id: 3, name: "Validation", parentId: 2, sortOrder: 0 },
      { id: 4, name: "FRM-VAL-001 CSA VALIDATION REPORT", parentId: 3, sortOrder: 0, linkedPath: "/blank-forms/start/frm-val-001" },
      { id: 5, name: "FRM-VAL-007 FUEL PUMP VALIDATION DOCUMENT", parentId: 3, sortOrder: 1, linkedPath: "/blank-forms/start/frm-val-007" },
      { id: 6, name: "Blank Form Templates", parentId: 1, sortOrder: 20 },
      { id: 7, name: "Calibration", parentId: 6, sortOrder: 0 },
      { id: 8, name: "Quality", parentId: 1, sortOrder: 4 },
    ];
    const names = visibleExplorerFolders(rows).map((folder) => folder.name);
    assert.equal(names.includes("Blank Forms Templates"), true);
    assert.equal(names.includes("Validation"), true);
    assert.equal(names.includes("FRM-VAL-001 CSA VALIDATION REPORT"), true);
    assert.equal(names.includes("Blank Form Templates"), false);
    assert.equal(names.includes("Calibration"), false);
    const validation = listFolder(visibleExplorerFolders(rows), 3);
    assert.deepEqual(
      validation.files.map((file) => file.name),
      ["FRM-VAL-001 CSA VALIDATION REPORT", "FRM-VAL-007 FUEL PUMP VALIDATION DOCUMENT"],
    );
    assert.equal(validation.folders.length, 0);
    assert.equal(isBlankTemplateLink(validation.files[0]?.linkedPath), true);
    assert.equal(openTarget(validation.files[0]!), "/blank-forms/start/frm-val-001");
    const offered = saveAsFolders(rows);
    assert.equal(offered.some((folder) => folder.name === "Blank Forms Templates" || folder.name === "Validation" || folder.name === "Blank Form Templates"), false);
    assert.equal(offered.some((folder) => folder.name === "Quality"), true);
    assert.equal(blankFormsFolderHref(), "/documents/folders?name=Blank%20Forms%20Templates");
  });

  it("opens a living Quality Manual list as a file", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null, sortOrder: 0 },
      { id: 2, name: "Quality Manual", parentId: 1, sortOrder: 0 },
      { id: 3, name: "Master Document List", parentId: 2, sortOrder: 0, linkedPath: "/documents/master-list" },
      { id: 4, name: "Master Equipment List", parentId: 2, sortOrder: 1, linkedPath: "/calibration/master-list" },
      { id: 5, name: "Scope of Laboratory Activities", parentId: 2, sortOrder: 2, linkedPath: "/documents/laboratory-scope" },
    ];
    assert.equal(isLivingListPath("/documents/master-list"), true);
    assert.equal(isLivingListPath("/documents/development-log"), true);
    assert.equal(isLivingListPath("/ncr"), false);
    const listing = listFolder(rows, 2);
    assert.deepEqual(listing.files.map((file) => file.name), ["Master Document List", "Master Equipment List", "Scope of Laboratory Activities"]);
    assert.equal(openTarget(rows[2]!), "/documents/master-list");
    assert.equal(openTarget(rows[3]!), "/calibration/master-list");
    assert.equal(openTarget(rows[4]!), "/documents/laboratory-scope");
  });

  it("lists folders before files, including a folder added after a living register", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "Quality Logs", parentId: null, sortOrder: 0 },
      { id: 2, name: "LST-NCR-001", parentId: 1, sortOrder: 0, linkedPath: "/documents/nonconformance-log" },
      { id: 3, name: "2026 Hold", parentId: 1, sortOrder: 5 },
    ];
    const listing = listFolder(rows, 1);
    assert.deepEqual(listing.folders.map((folder) => folder.name), ["2026 Hold"]);
    assert.deepEqual(listing.files.map((file) => file.name), ["LST-NCR-001"]);
    assert.equal(openTarget(rows[1]!), "/documents/nonconformance-log");
  });

  it("starts the folder tree closed and opens only the path to a deep-linked folder", () => {
    const rows: BrowseFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null, sortOrder: 0 },
      { id: 2, name: "Quality", parentId: 1, sortOrder: 0 },
      { id: 3, name: "Blank Forms Templates", parentId: 2, sortOrder: 0 },
      { id: 4, name: "NCR", parentId: 3, sortOrder: 0 },
    ];
    assert.deepEqual(treeOpenForTarget(rows, null), {});
    assert.deepEqual(treeOpenForTarget(rows, 3), { 1: true, 2: true });
    assert.equal(treeOpenForTarget(rows, 3)[3], undefined);
    assert.equal(treeOpenForTarget(rows, 3)[4], undefined);
    const page = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../routes/Documents/FolderExplorerPage.tsx"), "utf8");
    assert.match(page, /treeOpenForTarget/);
    assert.match(page, /treeOpen\[folder\.id\] === true/);
    assert.doesNotMatch(page, /treeOpen\[folder\.id\] \?\? isoRoot/);
    assert.doesNotMatch(page, /current\[id\] \?\? id === isoRoot/);
    assert.match(page, /collapsed\[sub\.id\] !== false/);
  });
});
