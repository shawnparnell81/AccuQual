import { describe, expect, it } from "vitest";
import { COMPANY_DOCUMENT_FOLDERS } from "../src/modules/document-folders/companyDocumentFolders.js";
import { DEFAULT_DOCUMENT_FOLDERS } from "../src/modules/document-folders/defaultDocumentFolders.js";
import { MAIN_ISO_FOLDER_NAMES } from "../src/modules/document-folders/mainIsoFolders.js";
import { planDuplicateFolderMerges, singleHomeSeedNames, type MergeFolder } from "../src/modules/document-folders/duplicateFolders.js";

const options = {
  singleHomeNames: singleHomeSeedNames(
    [...DEFAULT_DOCUMENT_FOLDERS, ...COMPANY_DOCUMENT_FOLDERS],
    MAIN_ISO_FOLDER_NAMES.map((name) => ["ISO Compliance Documents", name]),
  ),
  isoName: "ISO Compliance Documents",
  blankLibraryNames: ["Blank Form Templates", "Blank Forms Templates"],
  mainIsoNames: MAIN_ISO_FOLDER_NAMES,
};

function ids(plan: { sourceId: number; destId: number }[]) {
  return plan.map((move) => [move.sourceId, move.destId]).sort((a, b) => a[0]! - b[0]!);
}

describe("duplicate folder merge plan", () => {
  it("treats Quality as one home and Quality Manual as two homes on purpose", () => {
    expect(options.singleHomeNames.has("Quality")).toBe(true);
    expect(options.singleHomeNames.has("Quality Manual")).toBe(false);
    expect(options.singleHomeNames.has("Engineering Standards")).toBe(false);
    expect(options.singleHomeNames.has("Procedures")).toBe(false);
  });

  it("folds two folders that share a parent into the older one, and leaves a different parent alone", () => {
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
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([[4, 2]]);
  });

  it("folds a top-level department into the ISO copy and an empty recreated shell into the folder that was moved", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Master Source Files", parentId: 1 },
      { id: 3, name: "Quality", parentId: 2 },
      { id: 8, name: "FAI / Validation", parentId: 3 },
      { id: 9, name: "Quality", parentId: 1 },
      { id: 10, name: "Quality", parentId: null },
      { id: 11, name: "Old child", parentId: 10 },
    ];
    expect(ids(planDuplicateFolderMerges(folders, options))).toEqual([
      [9, 3],
      [10, 3],
    ]);
  });

  it("leaves two Quality folders alone when each one already holds a saved file", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 6, name: "Manual.pdf", parentId: 2, pdfPath: "files/manual.pdf" },
      { id: 3, name: "Master Source Files", parentId: 1 },
      { id: 4, name: "Quality", parentId: 3 },
      { id: 5, name: "Spec.pdf", parentId: 4, pdfPath: "files/spec.pdf" },
    ];
    expect(planDuplicateFolderMerges(folders, options)).toEqual([]);
  });

  it("leaves blank-template topics out of the company merge", () => {
    const folders: MergeFolder[] = [
      { id: 1, name: "ISO Compliance Documents", parentId: null },
      { id: 2, name: "Quality", parentId: 1 },
      { id: 3, name: "Blank Forms Templates", parentId: 1 },
      { id: 4, name: "Calibration", parentId: 3 },
      { id: 5, name: "Calibration", parentId: 2 },
    ];
    expect(planDuplicateFolderMerges(folders, options)).toEqual([]);
  });
});
