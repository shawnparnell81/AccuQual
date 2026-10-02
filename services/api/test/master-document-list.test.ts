import { describe, expect, it } from "vitest";
import { FORM_TEMPLATES, PRINTED_FORM_REVISION } from "../src/modules/document-folders/formFiling.js";
import { buildMasterDocumentRows, documentIdFromName, documentNumberForForm, withRegisteredForms, type RegisteredFormSource } from "../src/modules/documents/masterDocumentList.js";

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
      number: documentNumberForForm(seed.formKey, seed.formId, seed.title),
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

    expect(rows.filter((row) => row.documentId === "FRM-VAL-009").map((row) => row.title).sort()).toEqual([
      "AIR COMPRESSOR VALIDATION DOCUMENT",
      "BRAKE WEAR SENSOR VALIDATION DOCUMENT",
    ]);
    expect(rows.filter((row) => row.documentId === "FRM-VAL-007").map((row) => row.title).sort()).toEqual([
      "FUEL PUMP VALIDATION DOCUMENT",
      "GAS LIFT SUPPORT VALIDATION DOCUMENT",
    ]);
    expect(rows.find((row) => row.title === "Master Document List")).toMatchObject({ documentId: "LST-GEN-001", currentRev: "Rev B" });
    expect(rows.find((row) => row.title === "Master Equipment List")).toMatchObject({ documentId: "LST-EQP-001", currentRev: "Rev A" });
    expect(rows.find((row) => row.title === "Part Submission Warrant")).toMatchObject({ documentId: "FRM-PSW-001", status: "Template" });
    expect(rows.find((row) => row.title === "CSA VALIDATION REPORT")).toMatchObject({ documentId: "FRM-VAL-001", status: "Template" });
    expect(rows.find((row) => row.title === "INTERNAL AUDIT SUMMARY REPORT")).toMatchObject({ documentId: "FRM-GEN-002" });
    expect(rows.find((row) => row.title === "MONTHLY ENGINEERING DEVELOPMENT REPORT")).toMatchObject({ documentId: "RPT-ENG-001" });
    expect(rows.filter((row) => row.title === "ASTM E542 Gravimetric Volume Calculator").map((row) => row.documentId).sort()).toEqual([
      "FRM-TST-001",
      "FRM-TST-002",
    ]);
    expect(rows.find((row) => row.title === "Corrective Action Request")).toBeUndefined();
    expect(rows.find((row) => row.title === "8D Problem Solving")).toBeUndefined();
    expect(rows.find((row) => row.title === "Document Revision Record")).toBeUndefined();
    expect(FORM_TEMPLATES.find((seed) => seed.formKey === "frm-gen-002")?.formId).toBe("");
    expect(FORM_TEMPLATES.find((seed) => seed.formKey === "frm-val-007")?.formId).toBe("");

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
      const number = documentNumberForForm(seed.formKey, seed.formId, seed.title);
      if (number) continue;
      expect(rows.some((row) => row.href === seed.subjectRoute && row.title === seed.title && row.status === "Template")).toBe(false);
    }
  });

  it("reads a document id from the form name and leaves a name with no id blank", () => {
    expect(documentIdFromName("frm-qa-001")).toBe("FRM-QA-001");
    expect(documentIdFromName("frm_gen_002")).toBe("FRM-GEN-002");
    expect(documentIdFromName("DCR GEN 004")).toBe("DCR-GEN-004");
    expect(documentIdFromName("rpt-eng-001")).toBe("RPT-ENG-001");
    expect(documentIdFromName("8d")).toBe("");
    expect(documentIdFromName("document_revision_record")).toBe("");
    expect(documentIdFromName("capa")).toBe("");

    expect(documentNumberForForm("frm-gen-002", "", "INTERNAL AUDIT SUMMARY REPORT")).toBe("FRM-GEN-002");
    expect(documentNumberForForm("frm-psw-001", "QA-12", "Part Submission Warrant")).toBe("QA-12");
    expect(documentNumberForForm("frm-val-003", "FRM-VAL-009", "AIR COMPRESSOR VALIDATION DOCUMENT")).toBe("FRM-VAL-009");
    expect(documentNumberForForm("frm-val-005", "FRM-VAL-007", "GAS LIFT SUPPORT VALIDATION DOCUMENT")).toBe("FRM-VAL-007");
    expect(documentNumberForForm("frm-val-007", "", "FUEL PUMP VALIDATION DOCUMENT")).toBe("FRM-VAL-007");
    expect(documentNumberForForm("lst-eqp-001", "")).toBe("LST-EQP-001");
    expect(documentNumberForForm("custom", "", "Turtle Diagram FRM-PRC-001")).toBe("FRM-PRC-001");
    expect(documentNumberForForm("dcr", "", "Document Change Request")).toBe("");
    expect(documentNumberForForm("ncr", "", "Nonconformance Report")).toBe("");

    const fromName = FORM_TEMPLATES.filter((seed) => !seed.formId.trim()).map((seed) => ({
      formKey: seed.formKey,
      title: seed.title,
      number: documentNumberForForm(seed.formKey, seed.formId, seed.title),
    }));
    expect(fromName.filter((seed) => seed.number).map((seed) => `${seed.number} ${seed.title}`).sort()).toEqual([
      "FRM-CUS-001 Customer Scorecard",
      "FRM-FAE-001 Failure Action Effectiveness Chart",
      "FRM-FAI-001 First Article Inspection Report",
      "FRM-GEN-002 INTERNAL AUDIT SUMMARY REPORT",
      "FRM-MSA-001 Gage R&R",
      "FRM-PAR-001 Pareto Chart",
      "FRM-PRC-001 Turtle Diagram",
      "FRM-PSW-001 Part Submission Warrant",
      "FRM-QA-001 Quality Alert",
      "FRM-TST-001 ASTM E542 Gravimetric Volume Calculator",
      "FRM-TST-002 ASTM E542 Gravimetric Volume Calculator",
      "FRM-VAL-001 CSA VALIDATION REPORT",
      "FRM-VAL-007 FUEL PUMP VALIDATION DOCUMENT",
      "LST-EQP-001 Master Equipment List",
      "LST-GEN-001 Master Document List",
      "RPT-ENG-001 MONTHLY ENGINEERING DEVELOPMENT REPORT",
    ]);
    expect(fromName.filter((seed) => !seed.number).map((seed) => seed.formKey).sort()).toEqual([
      "8d",
      "audit-plan",
      "audit-report",
      "audit_finding_action_log",
      "cal-record",
      "cal-register",
      "capa",
      "change_control_record",
      "complaint",
      "dcr",
      "design_history_form",
      "deviation-waiver",
      "document_revision_record",
      "eco",
      "ecr",
      "final_inspection_release",
      "first_article_inspection",
      "in_process_inspection",
      "incoming_inspection_record",
      "management_review_record",
      "master_document_register",
      "ncr",
      "preventive_risk_action",
      "quality_kpi_monitoring",
      "quality_objectives_action_plan",
      "quality_record_disposition",
      "record_retention_log",
      "risk",
      "supplier-ncr",
      "supplier_qualification_evaluation",
      "training-record",
      "training_matrix",
    ]);
  });
});
