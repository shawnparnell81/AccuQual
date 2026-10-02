import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { documentControlIndexLayout } from "./layouts/documentControlIndex.ts";
import { formAllowsInlinePictures } from "./inlinePictures.ts";

describe("inline pictures", () => {
  it("keeps Insert Picture on issue and evidence forms", () => {
    for (const formType of ["ncr", "capa", "eight_d", "five_why", "complaint", "discrepancy_inspection"]) {
      assert.equal(formAllowsInlinePictures(formType), true, formType);
    }
  });

  it("does not offer Insert Picture on ordinary forms or the document operational title", () => {
    const title = documentControlIndexLayout.sections[0]?.blocks[0];
    assert.equal(title && title.type === "table" && title.columns.some((column) => column.label === "Document Operational Title" && column.kind === "textarea"), true);
    assert.equal(formAllowsInlinePictures("document_control_index"), false);
    for (const formType of ["calibration", "training", "fmea", "management_review", "audit_checklist"]) {
      assert.equal(formAllowsInlinePictures(formType), false, formType);
    }
  });
});
