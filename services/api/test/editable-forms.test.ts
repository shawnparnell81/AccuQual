import { describe, expect, it } from "vitest";
import { canEditFormNumber, resolveFolderPath, folderPathNames, recordLinkedPath, FILEABLE_FORM_KEYS } from "../src/modules/document-folders/editableForms.js";

describe("form number editors", () => {
  it("allows engineering, quality managers, and administrators", () => {
    expect(canEditFormNumber({ roleName: "admin", department: "quality" })).toBe(true);
    expect(canEditFormNumber({ roleName: "owner", department: null })).toBe(true);
    expect(canEditFormNumber({ roleName: "quality_manager", department: "production" })).toBe(true);
    expect(canEditFormNumber({ roleName: "operator", department: "engineering" })).toBe(true);
    expect(canEditFormNumber({ roleName: "operator", department: "quality" })).toBe(false);
    expect(canEditFormNumber({ roleName: "staff", department: "production" })).toBe(false);
  });
});

describe("subject folder suggestion", () => {
  const folders = [
    { id: 1, name: "Quality", parentId: null },
    { id: 2, name: "Customer Quality", parentId: 1 },
    { id: 3, name: "ISO Compliance Documents", parentId: null },
    { id: 4, name: "Blank Form Templates", parentId: 3 },
  ];

  it("walks the subject path and stops at the deepest folder that exists", () => {
    expect(resolveFolderPath(folders, ["Quality", "Customer Quality"])).toBe(2);
    expect(resolveFolderPath(folders, ["Quality", "Customer Quality", "Missing"])).toBe(2);
    expect(resolveFolderPath(folders, ["Engineering", "PPAP"])).toBeNull();
    expect(folderPathNames(folders, 2)).toEqual(["Quality", "Customer Quality"]);
    expect(folderPathNames(folders, 4)).toEqual(["ISO Compliance Documents", "Blank Form Templates"]);
    expect(resolveFolderPath(folders, ["Engineering", "Design & Development", "Design Validation"])).toBeNull();
  });
});

describe("saved form open path", () => {
  it("opens a validation fill from the folder row and leaves NCR off the filing list", () => {
    expect(recordLinkedPath("frm-val-001", 9)).toBe("/validation-reports/9");
    expect(recordLinkedPath("frm-val-007", 4)).toBe("/validation-reports/4");
    expect(recordLinkedPath("frm-qa-001", 3)).toBe("/iso-forms/record/3");
    expect(FILEABLE_FORM_KEYS.has("frm-val-001")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-val-007")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-ncr-001")).toBe(false);
    expect(FILEABLE_FORM_KEYS.has("ncr")).toBe(false);
    expect(FILEABLE_FORM_KEYS.has("capa")).toBe(false);
  });
});
