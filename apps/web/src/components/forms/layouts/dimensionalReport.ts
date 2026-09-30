import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the source "Dimensional Report.pdf" (Production Part
 * Approval — Dimensional Test Results). The source spans 2 PDF pages only
 * because its 24-row table is too wide to print in one column group; here
 * it's one continuous table. Pass / Fail is calculated from Nominal,
 * Tolerance, and Actual (see services/api/src/utils/passFail.ts).
 */
export const dimensionalReportLayout: FormLayout = {
  formType: "dimensional_report",
  title: "PRODUCTION PART APPROVAL — DIMENSIONAL TEST RESULTS",
  sections: [
    {
      number: "1",
      title: "REPORT HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "organization", label: "Organization:" },
            { kind: "text", name: "supplier", label: "Supplier:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "supplierVendorCode", label: "Supplier / Vendor Code:" },
            { kind: "text", name: "inspectionFacility", label: "Name of Inspection Facility:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "inspectionName", label: "Inspection Name:" },
            { kind: "text", name: "partNumber", label: "Part Number:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "partName", label: "Part Name:" },
            { kind: "text", name: "designRecordChangeLevel", label: "Design Record Change Level:" },
          ],
        },
        { type: "row", fields: [{ kind: "text", name: "engineeringChangeDocuments", label: "Engineering Change Documents:" }] },
      ],
    },
    {
      number: "2",
      title: "DIMENSIONAL TEST RESULTS",
      blocks: [
        {
          type: "table",
          name: "dimensions",
          addableRows: true,
          minRows: 24,
          columns: [
            { key: "dimensionSpecification", label: "Dimension / Specification", kind: "textarea" },
            { key: "nominal", label: "Nominal", kind: "text" },
            { key: "tolerance", label: "Tolerance", kind: "text", placeholder: "±0.10" },
            { key: "actual", label: "Actual", kind: "text" },
            { key: "passFail", label: "Pass / Fail", kind: "computed", formula: "dimensionalPassFail" },
            { key: "testDate", label: "Test Date", kind: "date" },
            { key: "qtyTested", label: "Qty. Tested", kind: "number" },
          ],
          legend: "Pass / Fail is calculated from Nominal, Tolerance, and Actual. Inside the tolerance is Pass (green). Outside is Fail (red).",
        },
        {
          type: "row",
          fields: [{ kind: "text", name: "conformanceNote", label: "Note:" }],
          // Blanket statements of conformance are unacceptable for any test result — carried as a fixed reminder, not user-editable text.
        },
      ],
    },
    {
      number: "3",
      title: "SIGN-OFF",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "signature", name: "signatureTitle", label: "Signature / Title:", certify: "I certify that this dimensional report is accurate." },
            { kind: "date", name: "signatureDate", label: "Date:" },
          ],
        },
      ],
    },
  ],
};
