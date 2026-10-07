import { describe, expect, it } from "vitest";
import { COMPANY_DOCUMENT_FOLDERS } from "../src/modules/document-folders/companyDocumentFolders.js";
import { DEFAULT_DOCUMENT_FOLDERS } from "../src/modules/document-folders/defaultDocumentFolders.js";
import { ISO_ROOT_NAME, MAIN_ISO_FOLDER_NAMES } from "../src/modules/document-folders/mainIsoFolders.js";
import {
  CANONICAL_FOLDER_HOMES,
  namesOutsideBlankDrawers,
  planBlankShortcutReturns,
  planBlankTopicRenames,
  planDuplicateFolderMerges,
  repeatedSeedFolderNames,
  type MergeFolder,
} from "../src/modules/document-folders/duplicateFolders.js";

const options = {
  isoName: ISO_ROOT_NAME,
  blankShelfNames: ["Blank Forms Templates"],
  legacyDrawerNames: ["Blank Form Templates"],
  mainIsoNames: MAIN_ISO_FOLDER_NAMES,
  canonicalHomes: CANONICAL_FOLDER_HOMES,
};

function ids(plan: { sourceId: number; destId: number }[]) {
  return plan.map((move) => [move.sourceId, move.destId]).sort((a, b) => a[0]! - b[0]!);
}

describe("duplicate folder merge plan", () => {
  it("gives every seeded folder name one path, including the 14 main drawers", () => {
    const repeated = repeatedSeedFolderNames(
      [...DEFAULT_DOCUMENT_FOLDERS, ...COMPANY_DOCUMENT_FOLDERS],
      MAIN_ISO_FOLDER_NAMES.map((name) => [ISO_ROOT_NAME, name]),
    );
    expect(repeated).toEqual([]);
  });

  it("folds Quality Manual, Engineering Standards, and a same-parent copy into the one home", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: "Notes", parentId: 2 },
      { id: 4, name: "Quality", parentId: 1 },
      { id: 5, name: "Kept notes", parentId: 4 },
      { id: 6, name: "Quality Manual", parentId: 1 },
      { id: 7, name: "Quality Manual & Policies", parentId: 2 },
      { id: 8, name: "Quality Manual", parentId: 7 },
      { id: 9, name: "Engineering Standards", parentId: 1 },
      { id: 10, name: "Specifications & Standards", parentId: 2 },
      { id: 11, name: "Engineering Standards", parentId: 10 },
      { id: 12, name: "Procedures", parentId: 1 },
      { id: 13, name: "SOP", parentId: 1 },
      { id: 14, name: "Procedures", parentId: 13 },
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([
      [4, 2],
      [8, 6],
      [11, 9],
      [14, 12],
    ]);
  });

  it("keeps the nested copy when the main drawer was deleted", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 7, name: "Quality Manual & Policies", parentId: 2 },
      { id: 8, name: "Quality Manual", parentId: 7 },
      { id: 15, name: "Scope notes", parentId: 8 },
      { id: 16, name: "Old policies", parentId: 2 },
      { id: 17, name: "Quality Manual", parentId: 16 },
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([[17, 8]]);
  });

  it("folds a misplaced department into the ISO copy and brings its saved child along in the plan", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Master Source Files", parentId: 1 },
      { id: 3, name: "Quality", parentId: 2, pdfPath: null },
      { id: 8, name: "FAI / Validation", parentId: 3 },
      { id: 9, name: "Quality", parentId: 1 },
      { id: 10, name: "Quality", parentId: null },
      { id: 11, name: "Old child", parentId: 10 },
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([
      [3, 9],
      [10, 9],
    ]);
  });

  it("folds two Quality folders that each already hold a saved file into the ISO home", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 6, name: "Manual.pdf", parentId: 2, pdfPath: "files/manual.pdf" },
      { id: 3, name: "Master Source Files", parentId: 1 },
      { id: 4, name: "Quality", parentId: 3 },
      { id: 5, name: "Spec.pdf", parentId: 4, pdfPath: "files/spec.pdf" },
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([[4, 2]]);
  });

  it("leaves a blank-template topic in place and does not fold the hidden living-list drawer", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: "Blank Forms Templates", parentId: 1 },
      { id: 4, name: "Document Control", parentId: 3 },
      { id: 5, name: "Document Control", parentId: 2 },
      { id: 6, name: "Blank Form Templates", parentId: 1 },
      { id: 7, name: "Document Control", parentId: 6 },
      { id: 8, name: "Calibration", parentId: 3 },
      { id: 9, name: "Calibration", parentId: 6 },
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([]);
    const drawers = ["Blank Forms Templates", "Blank Form Templates"];
    expect(planBlankTopicRenames(folders, 3, ["Document Control", "Calibration"], drawers)).toEqual([
      { folderId: 4, fromName: "Document Control", toName: "Document Control Forms" },
    ]);
    const outside = namesOutsideBlankDrawers(folders, drawers);
    expect(
      planBlankShortcutReturns(
        [
          ...folders,
          { id: 10, name: "Document Change Request", parentId: 5, linkedPath: "/blank-forms/start/dcr" },
          { id: 11, name: "CSA VALIDATION REPORT", parentId: 8, linkedPath: "/blank-forms/start/frm-val-001" },
          { id: 12, name: "Training record", parentId: 1, linkedPath: "/blank-forms/start/training-record" },
        ],
        3,
        (folder) => (folder.linkedPath?.startsWith("/blank-forms/start/") ? folder.linkedPath.slice("/blank-forms/start/".length) : null),
        (formKey) => (formKey === "dcr" ? "Document Control" : formKey === "training-record" ? "Training" : formKey === "frm-val-001" ? "Validation" : null),
        outside,
      ),
    ).toEqual([
      { shortcutId: 10, formKey: "dcr", topic: "Document Control", folderName: "Document Control Forms" },
      { shortcutId: 12, formKey: "training-record", topic: "Training", folderName: "Training" },
    ]);
  });

  it("folds Calibration Certificates into the Quality equipment drawer", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Engineering", parentId: 1 },
      { id: 3, name: "Calibration & Measurement", parentId: 2 },
      { id: 4, name: "Calibration Certificates", parentId: 3 },
      { id: 5, name: "Quality", parentId: 1 },
      { id: 6, name: "Records", parentId: 5 },
      { id: 7, name: "Calibration Certificates", parentId: 6 },
      { id: 8, name: "Calibration & Equipment", parentId: 5 },
      { id: 9, name: "Calibration Certificates", parentId: 8 },
      { id: 10, name: "Cert.pdf", parentId: 4, pdfPath: "files/cert.pdf" },
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([
      [4, 9],
      [7, 9],
    ]);
  });
});
