import { describe, expect, it } from "vitest";
import { canEditFormNumber, resolveFolderPath, folderPathNames, recordLinkedPath, FILEABLE_FORM_KEYS, SUGGESTED_SUBJECT_PATH, validationKind } from "../src/modules/document-folders/editableForms.js";
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
    expect(recordLinkedPath("frm-val-011", 11)).toBe("/validation-reports/11");
    expect(recordLinkedPath("frm-val-008", 8)).toBe("/validation-reports/8");
    expect(recordLinkedPath("lst-vis-001", 2)).toBe("/iso-forms/record/2");
    expect(recordLinkedPath("rpt-eng-001", 5)).toBe("/iso-forms/record/5");
    expect(recordLinkedPath("frm-gen-002", 3)).toBe("/iso-forms/record/3");
    expect(recordLinkedPath("frm-qa-001", 3)).toBe("/iso-forms/record/3");
    expect(FILEABLE_FORM_KEYS.has("frm-val-001")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-val-007")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-val-010")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-gen-002")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("frm-val-011")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("lst-vis-001")).toBe(true);
    expect(FILEABLE_FORM_KEYS.has("rpt-eng-001")).toBe(true);
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
    expect(validationKind({ formType: "air_spring" })).toBe("air_spring");
    expect(validationKind({})).toBe("csa");
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-val-008")?.formId).toBe("");
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-val-003")).toMatchObject({ formId: "", title: "Air Compressor Validation" });
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-val-005")).toMatchObject({ formId: "", title: "Gas Lift Support Validation" });
    expect(validationKind({ formType: "gas_lift" })).toBe("gas_lift");
    expect(validationKind({ formType: "electric_lift" })).toBe("electric_lift");
    expect(recordLinkedPath("frm-val-002", 13)).toBe("/validation-reports/13");
    expect(FILEABLE_FORM_KEYS.has("frm-val-006")).toBe(true);
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-dev-001")).toMatchObject({ formId: "", title: "CSA Development Document" });
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-dev-006")).toMatchObject({ formId: "", title: "Air Strut Development Document", subjectRoute: "/iso-forms/frm-dev-006" });
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-dev-006")?.start?.body).toEqual({ formType: "dev_air_strut", data: { cells: { F2: "Maxwell Tollefson", B9: "Shawn Parnell" } } });
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-val-010")?.start?.body).toEqual({ data: { formType: "air_strut", cells: {} } });
    expect(FILEABLE_FORM_KEYS.has("frm-dev-011")).toBe(true);
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-dev-012")).toMatchObject({ formId: "", title: "Electronic CSA Development Document" });
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-dev-013")?.title).toBe("Shock Absorber Development Document");
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-ecr-001")).toMatchObject({ formId: "", title: "Engineering Change Request (ECR)", subjectRoute: "/iso-forms/frm-ecr-001" });
    expect(FORM_TEMPLATES.filter((form) => form.formKey === "frm-ncr-001")).toHaveLength(1);
    expect(FORM_TEMPLATES.filter((form) => form.formKey === "frm-ncr-002")).toHaveLength(1);
    expect(FORM_TEMPLATES.filter((form) => form.formKey === "frm-gen-001")).toHaveLength(1);
    expect(SUGGESTED_SUBJECT_PATH["frm-ecr-001"]).toEqual(["Engineering", "Engineering Change Control", "Engineering Change Requests (ECR)"]);
    expect(SUGGESTED_SUBJECT_PATH["frm-dev-009"]).toEqual(["Engineering", "Design & Development"]);
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-car-001")?.title).toBe("Supplier Corrective Action Request (SCAR)");
    expect(FORM_TEMPLATES.find((form) => form.formKey === "frm-ncr-003")?.title).toBe("Concession / Deviation Request");
    expect(recordLinkedPath("frm-tst-001", 19)).toBe("/iso-forms/record/19");
    expect(FILEABLE_FORM_KEYS.has("frm-trp-002")).toBe(true);
    expect(FORM_TEMPLATES.find((form) => form.formKey === "lst-vis-001")?.title).toBe("DMA Laboratory Visitor Log");
    expect(FORM_TEMPLATES.find((form) => form.formKey === "rpt-eng-001")?.title).toBe("Monthly Engineering Development Report");
  });
});
