import { describe, expect, it } from "vitest";
import { FORM_TEMPLATES, OMITTED_FROM_MASTER_DOCUMENT_LIST } from "../src/modules/document-folders/formFiling.js";
import { canMaintainMasterList, isMasterListWrite, isMasterToolListEditPath } from "../src/modules/roles/masterListAccess.js";

describe("master list access", () => {
  it("lets Engineering, Quality Manager, VP of Engineering and Quality, and Admin maintain every master list", () => {
    expect(canMaintainMasterList({ roleName: "admin", department: null })).toBe(true);
    expect(canMaintainMasterList({ roleName: "owner", department: "quality" })).toBe(true);
    expect(canMaintainMasterList({ roleName: "quality_manager", department: "production" })).toBe(true);
    expect(canMaintainMasterList({ roleName: "operator", department: "engineering" })).toBe(true);
    expect(canMaintainMasterList({ roleName: "VP of Engineering and Quality", department: null })).toBe(true);
    expect(canMaintainMasterList({ roleName: "operator", department: "production" })).toBe(false);
    expect(canMaintainMasterList({ roleName: "VP of Operations", department: "quality" })).toBe(false);
  });

  it("opens master-list writes for maintainers and leaves other routes closed", () => {
    expect(isMasterListWrite("/documents", "PATCH", "/master-list/rows")).toBe(true);
    expect(isMasterListWrite("/documents", "DELETE", "/12")).toBe(true);
    expect(isMasterListWrite("/documents", "PATCH", "/12")).toBe(false);
    expect(isMasterListWrite("/equipment", "POST", "/")).toBe(true);
    expect(isMasterListWrite("/equipment", "PATCH", "/4")).toBe(true);
    expect(isMasterListWrite("/equipment", "DELETE", "/4")).toBe(true);
    expect(isMasterListWrite("/equipment", "POST", "/4/status")).toBe(true);
    expect(isMasterListWrite("/equipment", "POST", "/4/calibration")).toBe(true);
    expect(isMasterListWrite("/equipment", "POST", "/notify-due")).toBe(false);
    expect(isMasterListWrite("/equipment", "DELETE", "/calibration/4")).toBe(false);
    expect(isMasterListWrite("/ncr", "DELETE", "/4")).toBe(false);
  });

  it("opens Master Tool List draft edits and leaves publish closed", () => {
    expect(isMasterToolListEditPath("POST", "/")).toBe(true);
    expect(isMasterToolListEditPath("POST", "/4/draft")).toBe(true);
    expect(isMasterToolListEditPath("PATCH", "/4/draft/9")).toBe(true);
    expect(isMasterToolListEditPath("POST", "/4/version/9/publish")).toBe(false);
    expect(isMasterToolListEditPath("POST", "/4/version/9/review/approve")).toBe(false);
  });

  it("keeps Master Document List and does not offer Document Control Master Index", () => {
    expect(FORM_TEMPLATES.some((form) => form.formKey === "lst-gen-001" && form.title === "Master Document List")).toBe(true);
    expect(FORM_TEMPLATES.some((form) => form.formKey === "document_revision_record")).toBe(true);
    expect(FORM_TEMPLATES.some((form) => form.formKey === "document_control_index" || /master index/i.test(form.title))).toBe(false);
    expect(FORM_TEMPLATES.some((form) => form.formKey === "master_document_register")).toBe(false);
    const calculators = FORM_TEMPLATES.filter((form) => form.formKey === "frm-tst-001" || form.formKey === "frm-tst-002");
    expect(calculators.map((form) => form.formKey)).toEqual(["frm-tst-001", "frm-tst-002"]);
    expect(calculators.every((form) => form.start != null)).toBe(true);
    expect([...OMITTED_FROM_MASTER_DOCUMENT_LIST]).toEqual(["frm-tst-001", "frm-tst-002"]);
  });
});
