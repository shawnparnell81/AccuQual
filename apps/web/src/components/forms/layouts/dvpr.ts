import type { FormLayout } from "./types";

/** Derived 1:1 from the user-provided "DVPR Template.pdf" (Design Validation Plan and Report). */
export const dvprLayout: FormLayout = {
  formType: "dvpr",
  title: "DESIGN VALIDATION PLAN AND REPORT (DVP&R)",
  sections: [
    {
      number: "1",
      title: "HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "supplierName", label: "Supplier Name:" },
            { kind: "text", name: "productProject", label: "Product / Project:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "drawingPn", label: "Drawing P/N:" },
            { kind: "date", name: "startTests", label: "Start Tests:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "date", name: "endTest", label: "End Test:" },
            { kind: "date", name: "updateDate", label: "Update:" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "TEST PLAN & REPORT",
      blocks: [
        {
          type: "table",
          name: "tests",
          addableRows: true,
          minRows: 15,
          columns: [
            { key: "typeTest", label: "Type Test", kind: "text" },
            { key: "testDefinition", label: "Test Definition", kind: "textarea" },
            { key: "std", label: "Std.", kind: "text" },
            { key: "paragraph", label: "Paragraph", kind: "text" },
            { key: "edition", label: "Edition", kind: "text" },
            { key: "toolsUsed", label: "Tools Used", kind: "text" },
            { key: "plannedStart", label: "Planned Start", kind: "date" },
            { key: "plannedFinish", label: "Planned Finish", kind: "date" },
            { key: "actualStart", label: "Actual Start", kind: "date" },
            { key: "actualFinish", label: "Actual Finish", kind: "date" },
            { key: "sampleN", label: "Sample N.", kind: "text" },
            {
              key: "checkPoint",
              label: "Check Point Reached",
              kind: "checkboxGroup",
              options: ["10%", "20%", "30%", "40%", "50%", "60%", "70%", "80%", "90%"],
            },
            { key: "refReport", label: "Ref. Report", kind: "text" },
            { key: "result", label: "Result", kind: "checkboxGroup", options: ["OK", "KO"] },
            { key: "date", label: "Date", kind: "date" },
            { key: "signedBy", label: "Signed By", kind: "text" },
            { key: "notes", label: "Notes", kind: "textarea" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "AGREEMENTS",
      blocks: [
        {
          type: "table",
          name: "designPlanAgreement",
          labelColumnHeader: "Agreement on Design Plan Test",
          fixedRowLabels: ["Supplier", "Client Representative"],
          columns: [
            { key: "signature", label: "Signature", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
        {
          type: "table",
          name: "resultsAgreement",
          labelColumnHeader: "Agreement on Results and Test Report",
          fixedRowLabels: ["Supplier", "Client Representative"],
          columns: [
            { key: "signature", label: "Signature", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
