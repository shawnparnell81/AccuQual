import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { blankFormFileName, blankFormsByName, blankRenameProblem, blankTemplateTopic, templatesOnBlankShelf } from "./blankFormsList.ts";

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

describe("Blank Forms explorer names", () => {
  it("shows the controlled number then the title, or only the title when there is no number", () => {
    assert.equal(blankFormFileName({ formId: "FRM-DEV-009", title: "AIR COMPRESSOR DEVELOPMENT DOCUMENT" }), "FRM-DEV-009 AIR COMPRESSOR DEVELOPMENT DOCUMENT");
    assert.equal(blankFormFileName({ formId: "  ", title: "Turtle diagram" }), "Turtle diagram");
    assert.equal(blankFormFileName({ formId: "LST-GEN-001", title: "Old", displayTitle: "Master List" }), "LST-GEN-001 Master List");
  });

  it("sorts A to Z by the shown name", () => {
    const rows = [
      { formKey: "c", formId: "", title: "Turtle diagram" },
      { formKey: "a", formId: "FRM-DEV-009", title: "Air" },
      { formKey: "b", formId: "FRM-DEV-001", title: "CSA" },
    ];
    assert.deepEqual(blankFormsByName(rows).map((row) => row.formKey), ["b", "a", "c"]);
  });

  it("rejects an empty name or a name another blank already shows", () => {
    const rows = [
      { formKey: "a", formId: "FRM-DEV-009", title: "Air" },
      { formKey: "b", formId: "", title: "Turtle diagram" },
    ];
    assert.equal(blankRenameProblem(rows, "a", "   "), "Name is required");
    assert.equal(blankRenameProblem(rows, "a", "turtle  DIAGRAM"), "Another blank form already has that name");
    assert.equal(blankRenameProblem(rows, "a", "Air Compressor"), null);
  });
});
