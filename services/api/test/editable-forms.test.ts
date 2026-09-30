import { describe, expect, it } from "vitest";
import { canEditFormNumber, resolveFolderPath, folderPathNames, recordLinkedPath, FILEABLE_FORM_KEYS, validationKind } from "../src/modules/document-folders/editableForms.js";
import { FORM_TEMPLATES } from "../src/modules/document-folders/formFiling.js";

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
    expect(recordLinkedPath("frm-val-010", 8)).toBe("/validation-reports/8");
    expect(recordLinkedPath("frm-gen-002", 3)).toBe("/iso-forms/record/3");
    expect(recordLinkedPath("frm-qa-001", 3)).toBe("/iso-forms/record/3");
    expect(FILEABLE_FORM_KEYS.has("frm-val-001")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-val-007")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-val-010")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-gen-002")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-ncr-001")).toBe(false);
    expect(FILEABLE_FORM_KEYS.has("ncr")).toBe(false);
    expect(FILEABLE_FORM_KEYS.has("capa")).toBe(false);
  });
});

describe("new blank forms", () => {
  it("leaves Air Strut Validation and the Internal Audit Summary Report without a preset number", () => {
    const air = FORM_TEMPLATES.find((form) => form.formKey === "frm-val-010");
    const summary = FORM_TEMPLATES.find((form) => form.formKey === "frm-gen-002");
    expect(air).toMatchObject({ formId: "", title: "Air Strut Validation", subjectRoute: "/folders/validation-reports" });
    expect(air?.start?.body).toEqual({ data: { formType: "air_strut", cells: {} } });
    expect(summary).toMatchObject({ formId: "", title: "Internal Audit Summary Report", subjectRoute: "/iso-forms/frm-gen-002" });
    expect(summary?.start?.body).toEqual({ formType: "audit_summary", data: { cells: { D5: "Shawn Parnell" } } });
    expect(FORM_TEMPLATES.some((form) => /standard operating procedure|work instruction|test method/i.test(form.title))).toBe(false);
    expect(validationKind({ formType: "air_strut" })).toBe("air_strut");
    expect(validationKind({})).toBe("csa");
  });
});
