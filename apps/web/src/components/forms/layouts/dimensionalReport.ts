import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the user-provided "Dimensional Report.pdf" (Production Part
 * Approval — Dimensional Test Results). The source spans 2 PDF pages only
 * because its 24-row table is too wide to print in one column group; here
 * it's one continuous table.
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
            { key: "specificationLimits", label: "Specification / Limits", kind: "text" },
            { key: "testDate", label: "Test Date", kind: "date" },
            { key: "qtyTested", label: "Qty. Tested", kind: "number" },
            { key: "measurementResults", label: "Organization Measurement Results (Data)", kind: "text" },
            { key: "okNotOk", label: "OK / Not OK", kind: "checkboxGroup", options: ["OK", "Not OK"] },
          ],
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
            { kind: "text", name: "signatureTitle", label: "Signature / Title:" },
            { kind: "date", name: "signatureDate", label: "Date:" },
          ],
        },
      ],
    },
  ],
};
