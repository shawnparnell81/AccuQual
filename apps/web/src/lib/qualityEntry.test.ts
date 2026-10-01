import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ISO_FORMS } from "./isoFormCatalog.ts";
import { BLANK_FORMS_PATH, FRM_NCR_PATH, QUARANTINE_NOTICE_PATH } from "./qualityEntry.ts";
import { SIDEBAR_FOLDERS, flattenSidebarLinks, isFolder } from "../components/layout/sidebarStructure.ts";

describe("default quality entry paths", () => {
  it("points a new NCR at the FRM NCR blank, which stays on the sidebar", () => {
    const frm = ISO_FORMS.find((form) => form.formKey === "frm-ncr-001");
    assert.equal(FRM_NCR_PATH, `/iso-forms/${frm?.formKey}`);
    const link = flattenSidebarLinks().find((item) => item.key === "frm-ncr-001");
    assert.deepEqual(link && { label: link.label, path: link.path }, { label: "FRM NCR", path: FRM_NCR_PATH });
    assert.equal(flattenSidebarLinks().some((item) => item.path === "/ncr"), false);
  });

  it("names the quarantine notice blank and keeps Blank Forms, CAPA, and FRM NCR in place", () => {
    const notice = ISO_FORMS.find((form) => form.formKey === "frm-ncr-002");
    assert.equal(notice?.formId, "FRM-NCR-002");
    assert.equal(QUARANTINE_NOTICE_PATH, `/iso-forms/${notice?.formKey}`);
    assert.equal(BLANK_FORMS_PATH, "/blank-forms");

    const quality = SIDEBAR_FOLDERS.find((folder) => folder.key === "quality");
    const ncrCapa = quality?.children.find((child) => isFolder(child) && child.key === "ncr-capa");
    assert.ok(ncrCapa && isFolder(ncrCapa));
    assert.deepEqual(
      ncrCapa.children.map((child) => ({ label: child.label, path: "path" in child ? child.path : undefined })),
      [
        { label: "FRM NCR", path: FRM_NCR_PATH },
        { label: "CAPA", path: "/capa" },
        { label: "8D", path: "/8d" },
      ],
    );
    const blank = flattenSidebarLinks().find((item) => item.key === "blank-forms");
    assert.deepEqual(blank && { label: blank.label, path: blank.path }, { label: "Blank Forms", path: BLANK_FORMS_PATH });
  });
});
