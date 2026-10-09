import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { defaultSaveDestination, formFolderForTemplate } from "./saveDestination.ts";

const folders = [
  { formKey: "frm-val-001", formKeys: ["frm-val-001"], name: "CSA VALIDATION REPORT" },
  { formKey: "frm-val-007", formKeys: ["frm-val-007"], name: "FUEL PUMP VALIDATION DOCUMENT" },
  { formKey: "dcr", formKeys: ["dcr", "frm-doc-001"], name: "Document Change Request" },
];

describe("save destination", () => {
  it("defaults to the folder whose title matches the form", () => {
    const destination = defaultSaveDestination({
      formKey: "frm-val-001",
      folders,
      filedParentId: null,
      filedParentPath: [],
    });
    assert.deepEqual(destination, { kind: "form", formKey: "frm-val-001", name: "CSA VALIDATION REPORT" });
    assert.equal(formFolderForTemplate(folders, "frm-doc-001")?.name, "Document Change Request");
    assert.equal(formFolderForTemplate(folders, "frm-fai-001"), null);
  });

  it("keeps a copy that is already in a Documents folder on that folder", () => {
    const destination = defaultSaveDestination({
      formKey: "frm-val-001",
      folders,
      filedParentId: 40,
      filedParentPath: ["ISO Compliance Documents", "Quality"],
    });
    assert.deepEqual(destination, { kind: "documents", folderId: 40 });
  });

  it("stays on the form folder when the copy was saved there", () => {
    const destination = defaultSaveDestination({
      formKey: "frm-val-007",
      folders,
      filedParentId: 88,
      filedParentPath: ["ISO Compliance Documents", "Saved Form Folders", "FUEL PUMP VALIDATION DOCUMENT"],
    });
    assert.deepEqual(destination, { kind: "form", formKey: "frm-val-007", name: "FUEL PUMP VALIDATION DOCUMENT" });
  });
});
