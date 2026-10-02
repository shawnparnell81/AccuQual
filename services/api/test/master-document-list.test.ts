import { describe, expect, it } from "vitest";
import { FORM_TEMPLATES, PRINTED_FORM_REVISION } from "../src/modules/document-folders/formFiling.js";
import { buildMasterDocumentRows, documentNumberForForm, withRegisteredForms, type RegisteredFormSource } from "../src/modules/documents/masterDocumentList.js";

describe("master document list", () => {
  it("builds a live row from the document, its published revision, and its folder", () => {
    const rows = buildMasterDocumentRows(
      [
        {
          id: 7,
          title: "Control of Documents",
          category: "sop-procedures",
          status: "approved",
          revisionCode: "Rev B",
          effectiveDate: new Date("2026-03-01T00:00:00Z"),
          isDeleted: false,
        },
        {
          id: 8,
          title: "Removed",
          category: null,
          status: "draft",
          revisionCode: null,
          effectiveDate: null,
          isDeleted: true,
        },
      ],
      [],
      [
        {
          subjectId: 7,
          versionNumber: 1,
          status: "archived",
          revisionCode: "Rev A",
          summary: "Initial release",
          publishedAt: new Date("2026-01-26T00:00:00Z"),
          reviewedAt: new Date("2026-01-26T00:00:00Z"),
          reviewedBy: 3,
        },
        {
          subjectId: 7,
          versionNumber: 2,
          status: "published",
          revisionCode: "Rev B",
          summary: "Added the folder column",
          publishedAt: new Date("2026-03-18T00:00:00Z"),
          reviewedAt: new Date("2026-03-18T00:00:00Z"),
          reviewedBy: 3,
        },
      ],
      new Map([[3, "Ron Wertz"]]),
      [
        { id: 1, name: "Quality", parentId: null, documentId: null },
        { id: 2, name: "Procedures", parentId: 1, documentId: 7 },
      ],
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      documentId: "DOC-7",
      title: "Control of Documents",
      currentRev: "Rev B",
      approvalDate: "2026-03-18",
      approvedBy: "Ron Wertz",
      location: "Quality / Procedures",
      status: "Approved",
    });
    expect(rows[0]?.revHistory).toContain("Rev A");
    expect(rows[0]?.revHistory).toContain("Rev B");
    expect(rows[0]?.revHistory).toContain("Added the folder column");
    expect(rows[0]?.href).toBe("/documents/7");
  });

  it("uses a typed approval and leaves a cleared cell blank", () => {
    const rows = buildMasterDocumentRows(
      [
        {
          id: 7,
          title: "Control of Documents",
          category: null,
          status: "approved",
          revisionCode: "Rev B",
          effectiveDate: new Date("2026-03-01T00:00:00Z"),
          isDeleted: false,
          registerApprovalDate: "",
          registerApprovedBy: "Quality",
        },
      ],
      [],
      [
        {
          subjectId: 7,
          versionNumber: 1,
          status: "published",
          revisionCode: "Rev B",
          summary: "",
          publishedAt: new Date("2026-03-18T00:00:00Z"),
          reviewedAt: null,
          reviewedBy: 3,
        },
      ],
      new Map([[3, "Ron Wertz"]]),
      [],
    );

    expect(rows[0]).toMatchObject({ approvalDate: null, approvedBy: "Quality" });
  });

  it("leaves a form row blank until an approval is saved", () => {
    const rows = withRegisteredForms(
      [],
      [
        {
          id: 4,
          formKey: "lst-gen-001",
          formId: "LST-GEN-001",
          title: "Master Document List",
          subjectRoute: "/documents/master-list",
          folderId: null,
          registerApprovalDate: "2026-04-02",
          registerApprovedBy: null,
        },
      ],
      [],
    );

    expect(rows[0]).toMatchObject({ id: -4, documentId: "LST-GEN-001", approvalDate: "2026-04-02", approvedBy: "" });
  });

  it("adds each current form that already has a number, and does not add a second row", () => {
    const templates: RegisteredFormSource[] = FORM_TEMPLATES.map((seed, index) => ({
      id: index + 1,
      formKey: seed.formKey,
      formId: seed.formId,
      title: seed.title,
      subjectRoute: seed.subjectRoute,
      folderId: seed.formKey === "frm-ncr-002" ? 4 : null,
    }));
    const folders = [
      { id: 1, name: "ISO Compliance Documents", parentId: null, documentId: null },
      { id: 2, name: "Blank Form Templates", parentId: 1, documentId: null },
      { id: 4, name: "Nonconformance", parentId: 2, documentId: null },
    ];
    const documents = buildMasterDocumentRows(
      [
        {
          id: 7,
          title: "Control of Documents",
          category: "sop-procedures",
          status: "approved",
          revisionCode: "Rev B",
          effectiveDate: null,
          isDeleted: false,
        },
        {
          id: 9,
          title: "NON-CONFORMANCE REPORT (NCR)",
          category: "forms",
          status: "approved",
          revisionCode: "Rev C",
          effectiveDate: null,
          isDeleted: false,
        },
      ],
      [],
      [],
      new Map(),
      [],
    );
    documents[1] = { ...documents[1]!, documentId: "FRM-NCR-001" };

    const rows = withRegisteredForms(documents, templates, folders);
    const again = withRegisteredForms(rows, templates, folders);
    expect(again).toEqual(rows);

    const expected = FORM_TEMPLATES.map((seed) => ({
      formKey: seed.formKey,
      title: seed.title,
      number: documentNumberForForm(seed.formKey, seed.formId),
      href: seed.subjectRoute,
    })).filter((seed) => seed.number);
    const formRows = rows.filter((row) => row.status === "Template" || (row.documentId === "FRM-NCR-001" && row.title === "NON-CONFORMANCE REPORT (NCR)"));
    expect(formRows).toHaveLength(expected.length);
    expect(rows.filter((row) => row.documentId === "DOC-7")).toHaveLength(1);
    expect(rows.filter((row) => row.documentId === "FRM-NCR-001" && row.title === "NON-CONFORMANCE REPORT (NCR)")).toHaveLength(1);
    expect(rows.find((row) => row.documentId === "FRM-NCR-001")?.status).toBe("Approved");

    const quarantine = rows.find((row) => row.documentId === "FRM-NCR-002");
    expect(quarantine).toMatchObject({
      title: "QUARANTINE NOTICE",
      currentRev: "Rev A",
      href: "/iso-forms/frm-ncr-002",
      status: "Template",
      location: "ISO Compliance Documents / Blank Form Templates / Nonconformance",
    });

    expect(rows.filter((row) => row.documentId === "FRM-VAL-009").map((row) => row.title)).toEqual(["BRAKE WEAR SENSOR VALIDATION DOCUMENT"]);
    expect(rows.filter((row) => row.documentId === "FRM-VAL-011").map((row) => row.title)).toEqual(["AIR STRUT VALIDATION DOCUMENT"]);
    expect(rows.find((row) => row.title === "AIR COMPRESSOR VALIDATION DOCUMENT")).toMatchObject({ documentId: "FRM-VAL-003" });
    expect(rows.find((row) => row.title === "ELECTRIC LIFT SUPPORT VALIDATION DOCUMENT")).toMatchObject({ documentId: "FRM-VAL-004" });
    expect(rows.find((row) => row.title === "GAS LIFT SUPPORT VALIDATION DOCUMENT")).toMatchObject({ documentId: "FRM-VAL-005" });
    expect(rows.filter((row) => row.documentId === "FRM-VAL-007").map((row) => row.title)).toEqual(["FUEL PUMP VALIDATION DOCUMENT"]);
    expect(rows.find((row) => row.title === "Master Document List")).toMatchObject({ documentId: "LST-GEN-001", currentRev: "Rev B" });
    expect(rows.find((row) => row.title === "Master Equipment List")).toMatchObject({ documentId: "LST-EQP-001", currentRev: "Rev A" });
    expect(rows.find((row) => row.title === "Part Submission Warrant")).toBeUndefined();
    expect(rows.find((row) => row.title === "CSA VALIDATION REPORT")).toMatchObject({ documentId: "FRM-VAL-001", status: "Template" });
    expect(rows.find((row) => row.title === "INTERNAL AUDIT SUMMARY REPORT")).toMatchObject({ documentId: "TMP-GEN-001" });
    expect(rows.find((row) => row.title === "MONTHLY ENGINEERING DEVELOPMENT REPORT")).toMatchObject({ documentId: "TMP-ENG-001" });
    expect(rows.filter((row) => row.title === "ASTM E542 Gravimetric Volume Calculator")).toEqual([]);
    expect(rows.some((row) => row.documentId === "FRM-TST-001" || row.documentId === "FRM-TST-002")).toBe(false);
    expect(rows.find((row) => row.title === "Corrective Action Request")).toBeUndefined();
    expect(rows.find((row) => row.title === "8D Problem Solving")).toBeUndefined();
    expect(rows.find((row) => row.title === "Document Revision Record")).toBeUndefined();
    expect(rows.find((row) => row.title === "Master Document Register")).toBeUndefined();
    expect(new Set(rows.map((row) => `${row.documentId}\n${row.title}`)).size).toBe(rows.length);

    const custom = withRegisteredForms(
      [],
      [{ id: 3, formKey: "lst-eqp-001", formId: "CAL-9", title: "Master Equipment List", subjectRoute: "/calibration/master-list", folderId: null }],
      [],
    );
    expect(custom).toEqual([
      expect.objectContaining({ documentId: "CAL-9", title: "Master Equipment List", href: "/calibration/master-list" }),
    ]);

    for (const seed of expected) {
      const match = rows.find((row) => row.documentId === seed.number && row.title === seed.title);
      if (seed.formKey === "frm-ncr-001") {
        expect(match).toMatchObject({ href: "/documents/9", status: "Approved", currentRev: "Rev C" });
        continue;
      }
      expect(match?.href).toBe(seed.href);
      expect(match?.status).toBe("Template");
      if (PRINTED_FORM_REVISION[seed.formKey]) expect(match?.currentRev).toBe(PRINTED_FORM_REVISION[seed.formKey]);
    }
    for (const seed of FORM_TEMPLATES) {
      if (documentNumberForForm(seed.formKey, seed.formId)) continue;
      expect(rows.some((row) => row.href === seed.subjectRoute && row.title === seed.title && row.status === "Template")).toBe(false);
    }
  });
});
