import { describe, expect, it } from "vitest";
import { canEditFormNumber, resolveFolderPath, folderPathNames } from "../src/modules/document-folders/editableForms.js";

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
  });
});
