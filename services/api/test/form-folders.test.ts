import { describe, expect, it } from "vitest";
import { FILEABLE_FORM_KEYS } from "../src/modules/document-folders/editableForms.js";
import { FORM_TEMPLATES, keptOutOfBlankFormsTemplates } from "../src/modules/document-folders/formFiling.js";
import { cleanFormFolderTitle, compareSavedFills, formFolderIndex, formKeyForSharedTitle, RETIRED_FORM_FOLDER_KEYS, savedFillFileName, sortSavedFills, type FolderTemplate } from "../src/modules/document-folders/formFolders.js";

describe("form folders", () => {
  const folders = formFolderIndex(FORM_TEMPLATES);

  it("uses a folder name for every form that can be filled or saved", () => {
    const keys = new Set(folders.flatMap((folder) => folder.formKeys));
    for (const key of FILEABLE_FORM_KEYS) expect(keys.has(key)).toBe(!RETIRED_FORM_FOLDER_KEYS.has(key));
    expect(keys.has("incoming_inspection_record")).toBe(true);
    expect(keys.has("ncr")).toBe(true);
    expect(keys.has("capa")).toBe(true);
    expect(keys.has("frm-par-001")).toBe(true);
    expect(keys.has("lst-gen-001")).toBe(false);
    expect(keys.has("lst-eqp-001")).toBe(false);
    expect(folders.some((folder) => folder.name === "Blank Form Templates" || folder.title === "Blank Form Templates")).toBe(false);
  });

  it("keeps air strut and air spring as their own folders", () => {
    expect(folders.find((folder) => folder.formKeys.includes("frm-val-010"))?.name).toBe("AIR STRUT VALIDATION DOCUMENT");
    expect(folders.find((folder) => folder.formKeys.includes("frm-val-011"))?.name).toBe("AIR SPRING VALIDATION DOCUMENT");
  });

  it("groups the live duplicate pairs and keeps different form numbers apart", () => {
    const names = folders.map((folder) => folder.name);
    const once = (name: string) => expect(names.filter((item) => item === name)).toEqual([name]);
    once("Document Change Request");
    once("Engineering Change Request");
    once("CSA VALIDATION REPORT");
    expect(names).not.toContain("DOCUMENT CHANGE REQUEST");
    expect(names).not.toContain("ENGINEERING CHANGE REQUEST (ECR)");
    expect(names).not.toContain("First Article Inspection Report");
    expect(names.some((name) => name.includes("first_article_inspection") || name.includes("frm-fai-001"))).toBe(false);

    expect(folders.find((folder) => folder.name === "Document Change Request")?.formKeys.sort()).toEqual(["dcr", "frm-doc-001"]);
    expect(folders.find((folder) => folder.name === "Engineering Change Request")?.formKeys.sort()).toEqual(["ecr", "frm-ecr-001"]);
    expect(folders.find((folder) => folder.name === "CSA VALIDATION REPORT")?.formKeys).toEqual(["frm-val-001"]);

    expect(names.filter((name) => name === "AIR STRUT VALIDATION DOCUMENT")).toEqual(["AIR STRUT VALIDATION DOCUMENT"]);
    expect(names.filter((name) => name === "AIR SPRING VALIDATION DOCUMENT")).toEqual(["AIR SPRING VALIDATION DOCUMENT"]);
    expect(names.filter((name) => name.startsWith("ASTM E542 Gravimetric Volume Calculator")).sort()).toEqual([
      "ASTM E542 Gravimetric Volume Calculator (FRM-TST-001)",
      "ASTM E542 Gravimetric Volume Calculator (FRM-TST-002)",
    ]);
  });

  it("strips a trailing acronym or internal key and keeps a real form number", () => {
    expect(cleanFormFolderTitle("Document Change Request")).toBe("Document Change Request");
    expect(cleanFormFolderTitle("DOCUMENT CHANGE REQUEST")).toBe("DOCUMENT CHANGE REQUEST");
    expect(cleanFormFolderTitle("Engineering Change Request")).toBe("Engineering Change Request");
    expect(cleanFormFolderTitle("ENGINEERING CHANGE REQUEST (ECR)")).toBe("ENGINEERING CHANGE REQUEST");
    expect(cleanFormFolderTitle("First Article Inspection Report (first_article_inspection)")).toBe("First Article Inspection Report");
    expect(cleanFormFolderTitle("First Article Inspection Report (frm-fai-001)")).toBe("First Article Inspection Report");
    expect(cleanFormFolderTitle("AIR STRUT VALIDATION DOCUMENT (FRM-VAL-010)")).toBe("AIR STRUT VALIDATION DOCUMENT (FRM-VAL-010)");
    expect(cleanFormFolderTitle("AIR STRUT VALIDATION DOCUMENT (FRM-VAL-011)")).toBe("AIR STRUT VALIDATION DOCUMENT (FRM-VAL-011)");
    expect(cleanFormFolderTitle("ASTM E542 Gravimetric Volume Calculator (FRM-TST-001)")).toBe("ASTM E542 Gravimetric Volume Calculator (FRM-TST-001)");
    expect(cleanFormFolderTitle("ASTM E542 Gravimetric Volume Calculator (FRM-TST-002)")).toBe("ASTM E542 Gravimetric Volume Calculator (FRM-TST-002)");

    const listed: FolderTemplate[] = [
      { formKey: "dcr", title: "Document Change Request", formId: "", start: {} },
      { formKey: "frm-doc-001", title: "DOCUMENT CHANGE REQUEST", formId: "FRM-DOC-001", start: {} },
      { formKey: "ecr", title: "Engineering Change Request", formId: "", start: {} },
      { formKey: "frm-ecr-001", title: "ENGINEERING CHANGE REQUEST (ECR)", formId: "FRM-ECR-001", start: {} },
      { formKey: "first_article_inspection", title: "First Article Inspection Report (first_article_inspection)", formId: "", start: {} },
      { formKey: "frm-fai-001", title: "First Article Inspection Report (frm-fai-001)", formId: "", start: {} },
      { formKey: "frm-val-010", title: "AIR STRUT VALIDATION DOCUMENT (FRM-VAL-010)", formId: "FRM-VAL-010", start: {} },
      { formKey: "frm-val-011", title: "AIR STRUT VALIDATION DOCUMENT (FRM-VAL-011)", formId: "FRM-VAL-011", start: {} },
      { formKey: "frm-tst-001", title: "ASTM E542 Gravimetric Volume Calculator (FRM-TST-001)", formId: "FRM-TST-001", start: {} },
      { formKey: "frm-tst-002", title: "ASTM E542 Gravimetric Volume Calculator (FRM-TST-002)", formId: "FRM-TST-002", start: {} },
    ];
    const grouped = formFolderIndex(listed).map((folder) => folder.name).sort();
    expect(grouped).toEqual([
      "AIR STRUT VALIDATION DOCUMENT (FRM-VAL-010)",
      "AIR STRUT VALIDATION DOCUMENT (FRM-VAL-011)",
      "ASTM E542 Gravimetric Volume Calculator (FRM-TST-001)",
      "ASTM E542 Gravimetric Volume Calculator (FRM-TST-002)",
      "Document Change Request",
      "Engineering Change Request",
    ]);
  });

  it("maps every blank template onto a folder and leaves retired First Article folders out", () => {
    const keys = new Set(folders.flatMap((folder) => folder.formKeys));
    for (const seed of FORM_TEMPLATES) {
      if (seed.start == null || keptOutOfBlankFormsTemplates(seed)) continue;
      expect(keys.has(seed.formKey)).toBe(!RETIRED_FORM_FOLDER_KEYS.has(seed.formKey));
    }
    expect(keys.has("frm-fai-001")).toBe(false);
    expect(keys.has("first_article_inspection")).toBe(false);
    expect(keys.has("frm-val-001")).toBe(true);
    expect(keys.has("frm-val-007")).toBe(true);
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
        formId: "FRM-NCR-001",
        title: "NON-CONFORMANCE REPORT (NCR)",
        recordId: 4,
        savedAt: "2026-10-05T15:00:00.000Z",
        pattern: "{formId}_{recordNumber}_{date}",
        recordLabel: "NON-CONFORMANCE REPORT (NCR)",
        number: "",
      }),
    ).toBe("FRM-NCR-001__2026-10-05");
    expect(
      savedFillFileName({
        formId: "FRM-NCR-001",
        title: "NON-CONFORMANCE REPORT (NCR)",
        recordId: 4,
        savedAt: "2026-10-05T15:00:00.000Z",
        pattern: "{formId}_{recordNumber}_{date}",
        recordLabel: "NON-CONFORMANCE REPORT (NCR)",
        number: "QA-14",
      }),
    ).toBe("FRM-NCR-001_QA-14_2026-10-05");
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
