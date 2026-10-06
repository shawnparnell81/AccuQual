import { describe, expect, it } from "vitest";
import { FILEABLE_FORM_KEYS } from "../src/modules/document-folders/editableForms.js";
import { FORM_TEMPLATES } from "../src/modules/document-folders/formFiling.js";
import { compareSavedFills, formFolderIndex, formKeyForSharedTitle, savedFillFileName, sortSavedFills } from "../src/modules/document-folders/formFolders.js";

describe("form folders", () => {
  const folders = formFolderIndex(FORM_TEMPLATES);

  it("uses a folder name for every form that can be filled or saved", () => {
    const keys = new Set(folders.map((folder) => folder.formKey));
    for (const key of FILEABLE_FORM_KEYS) expect(keys.has(key)).toBe(true);
    expect(keys.has("incoming_inspection_record")).toBe(true);
    expect(keys.has("ncr")).toBe(true);
    expect(keys.has("capa")).toBe(true);
    expect(keys.has("frm-par-001")).toBe(true);
    expect(keys.has("lst-gen-001")).toBe(false);
    expect(keys.has("lst-eqp-001")).toBe(false);
    expect(folders.some((folder) => folder.name === "Blank Form Templates" || folder.title === "Blank Form Templates")).toBe(false);
  });

  it("keeps two forms that share a title as two folders", () => {
    const struts = folders.filter((folder) => folder.title === "AIR STRUT VALIDATION DOCUMENT").map((folder) => folder.name);
    expect(struts.sort()).toEqual(["AIR STRUT VALIDATION DOCUMENT (FRM-VAL-010)", "AIR STRUT VALIDATION DOCUMENT (FRM-VAL-011)"]);
  });

  it("orders saved copies by save date, then file name", () => {
    const sorted = sortSavedFills([
      { savedAt: "2026-10-01T00:00:00.000Z", fileName: "B", recordId: 1 },
      { savedAt: "2026-10-03T00:00:00.000Z", fileName: "C", recordId: 3 },
      { savedAt: "2026-10-03T00:00:00.000Z", fileName: "A", recordId: 4 },
      { savedAt: "2026-10-03T00:00:00.000Z", fileName: "A", recordId: 2 },
    ]);
    expect(sorted.map((row) => row.recordId)).toEqual([2, 4, 3, 1]);
    expect(compareSavedFills(sorted[0]!, sorted[1]!)).toBeLessThan(0);
  });

  it("names a saved copy from the record label, otherwise from the form number and date", () => {
    expect(
      savedFillFileName({
        formId: "FRM-NCR-001",
        title: "NON-CONFORMANCE REPORT (NCR)",
        recordId: 4,
        savedAt: "2026-10-05T15:00:00.000Z",
        pattern: "{formId}_{recordNumber}_{date}",
        recordLabel: "NON-CONFORMANCE REPORT (NCR)",
      }),
    ).toBe("FRM-NCR-001_4_2026-10-05");
    expect(
      savedFillFileName({
        formId: "",
        title: "Corrective Action Request",
        recordId: 8,
        savedAt: "2026-10-05T15:00:00.000Z",
        pattern: "{formId}_{recordNumber}_{date}",
        recordLabel: "Weld porosity",
      }),
    ).toBe("Weld porosity");
  });

  it("sends a shared-table record to that form, and other NCRs to the NCR folder", () => {
    const matches = [
      { formKey: "supplier-ncr", match: "Supplier NCR" },
      { formKey: "complaint", match: "Customer Complaint Record" },
      { formKey: "ncr", match: "Nonconformance Report" },
    ];
    expect(formKeyForSharedTitle(matches, "Supplier NCR", "ncr")).toBe("supplier-ncr");
    expect(formKeyForSharedTitle(matches, "Line reject", "ncr")).toBe("ncr");
    expect(formKeyForSharedTitle([{ formKey: "audit-plan", match: "Internal Audit Plan" }], "Weekly audit", null)).toBeNull();
  });
});
