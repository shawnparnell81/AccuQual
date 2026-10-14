import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { REGISTRY } from "./registry";
import { SHOCK_FORM } from "./forms/shock";
import { createFolderChoices, defaultCreateFolder, folderPathLabel } from "../createFolderChoice";

describe("Shock header and sign-off", () => {
  it("Project Information values and Notes take typing", () => {
    for (const at of ["B5", "D5", "F5", "H5", "B6", "D6"]) assert.equal(SHOCK_FORM.kinds[at], "input", at);
    assert.equal(SHOCK_FORM.kinds.B44, "area");
  });
  it("Approved By and the Conditional Pass engineer are PIN signatures", () => {
    assert.equal(SHOCK_FORM.kinds.F6, "signature");
    assert.equal(SHOCK_FORM.kinds.G44, "signature");
    const api = readFileSync(new URL("../../../../../services/api/src/modules/validation-reports/validation-reports.controller.ts", import.meta.url), "utf8");
    for (const slot of SHOCK_FORM.def.signatures ?? []) assert.ok(api.includes(slot.certify), slot.path);
  });
  it("every workbook-driven validation form has a PIN sign-off", () => {
    for (const [type, module] of Object.entries(REGISTRY)) assert.ok((module.def.signatures ?? []).length > 0, type);
  });
  it("no bordered box with only spaces is left as fixed text", () => {
    for (const [type, module] of Object.entries(REGISTRY)) {
      for (const [at, cell] of Object.entries(module.def.layout.cells)) {
        if (typeof cell.v === "string" && cell.v.trim() === "" && cell.v !== "") assert.notEqual(module.kinds[at], "label", `${type} ${at}`);
      }
    }
  });
});

describe("New report folder picker", () => {
  const folders = [
    { id: 1, name: "ISO Compliance Documents", parentId: null, sortOrder: 0 },
    { id: 2, name: "Quality", parentId: 1, sortOrder: 0 },
    { id: 3, name: "FAI / Validation", parentId: 2, sortOrder: 0 },
    { id: 4, name: "Made Today", parentId: 3, sortOrder: 9 },
  ];
  it("lists the live folders with their path and starts on the current folder", () => {
    const choices = createFolderChoices(folders);
    assert.ok(choices.some((choice) => choice.id === 4 && choice.path === "Documents > ISO Compliance Documents > Quality > FAI / Validation > Made Today"));
    assert.equal(defaultCreateFolder(choices, 3), 3);
    assert.equal(defaultCreateFolder(choices, 999), "");
    assert.equal(folderPathLabel(folders, 3), "Documents > ISO Compliance Documents > Quality > FAI / Validation");
  });
});
