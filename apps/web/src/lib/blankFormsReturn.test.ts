import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { BLANK_FORMS_PATH, leaveFormPath } from "./blankDraft";

describe("leaving a form opened from Blank Forms", () => {
  it("an unsaved blank returns to Blank Forms; a saved record returns to its folder", () => {
    assert.equal(BLANK_FORMS_PATH, "/blank-forms");
    assert.equal(leaveFormPath(true, "/documents/folders?name=FAI"), "/blank-forms");
    assert.equal(leaveFormPath(false, "/documents/folders?name=FAI"), "/documents/folders?name=FAI");
  });
  it("validation and ISO form pages send crumb and Discard through it", () => {
    const validation = readFileSync(new URL("../routes/ValidationReports/ValidationReportDetailPage.tsx", import.meta.url), "utf8");
    assert.match(validation, /leaveFormPath\(true/);
    assert.match(validation, /navigateTo=\{leaveCrumb\.to\}/);
    const iso = readFileSync(new URL("../routes/IsoForms/IsoFormDetailPage.tsx", import.meta.url), "utf8");
    assert.match(iso, /navigateTo=\{leaveFormPath\(record\.id === 0/);
  });
});
