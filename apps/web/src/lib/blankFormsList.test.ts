import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankTemplateTopic, templatesOnBlankShelf } from "./blankFormsList.ts";

describe("blank forms list", () => {
  const rows = [
    { formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA VALIDATION REPORT", isoPath: ["Blank Forms Templates", "Validation"], onBlankShelf: true },
    { formKey: "frm-val-007", formId: "FRM-VAL-007", title: "FUEL PUMP VALIDATION DOCUMENT", isoPath: ["Blank Forms Templates", "Validation"], onBlankShelf: true },
    { formKey: "frm-fai-001", formId: "", title: "First Article Inspection Report", isoPath: ["Blank Forms Templates", "Production & Inspection"], onBlankShelf: true },
    { formKey: "lst-gen-001", formId: "LST-GEN-001", title: "Master Document List", isoPath: ["Quality Manual"], onBlankShelf: false },
    { formKey: "moved", formId: "", title: "Moved blank", isoPath: ["Quality", "Inspections"], onBlankShelf: false },
  ];

  it("lists the Blank Forms Templates shelf, including FAI-type blanks, and skips everything else", () => {
    const listed = templatesOnBlankShelf(rows);
    assert.deepEqual(
      listed.map((row) => row.formKey),
      ["frm-val-001", "frm-fai-001", "frm-val-007"],
    );
    assert.equal(listed.some((row) => row.formKey === "lst-gen-001" || row.formKey === "moved"), false);
  });

  it("uses the topic under the shelf as the section name", () => {
    assert.equal(blankTemplateTopic(["Blank Forms Templates", "Validation"]), "Validation");
    assert.equal(blankTemplateTopic(["Blank Forms Templates"]), "Blank Forms");
  });

  it("falls back to the path when the shelf flag is missing", () => {
    const listed = templatesOnBlankShelf([
      { formKey: "frm-val-001", formId: "FRM-VAL-001", title: "CSA VALIDATION REPORT", isoPath: ["Blank Forms Templates", "Validation"] },
      { formKey: "other", formId: "", title: "Other", isoPath: ["Quality"] },
    ]);
    assert.deepEqual(listed.map((row) => row.formKey), ["frm-val-001"]);
  });
});
