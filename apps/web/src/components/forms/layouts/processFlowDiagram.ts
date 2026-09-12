import type { FormLayout } from "./types";

/**
 * Derived from the user-provided "Process Flow Diagram.pdf". The source
 * spans several PDF pages because it's a wide operation-sequence table plus
 * a page of drawing-toolbar shape symbols for hand-drawing connectors between
 * steps — that connector diagram is a freeform drawing exercise, not
 * fillable-form data, so it isn't reproduced here. What IS reproduced,
 * losslessly and on one page, is the actual content: the numbered process
 * steps and their characteristics, with each step's type recorded as a
 * plain label (Operation / Inspection / Op+Insp / Transport / Delay /
 * Storage / Other) instead of a hand-drawn shape.
 */
export const processFlowDiagramLayout: FormLayout = {
  formType: "process_flow_diagram",
  title: "PROCESS FLOW DIAGRAM",
  sections: [
    {
      number: "1",
      title: "HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "customer", label: "Customer:" },
            { kind: "text", name: "customerPartNumber", label: "Customer Part Number:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "supplier", label: "Supplier:" },
            { kind: "text", name: "supplierPartNumber", label: "Supplier Part Number:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "partName", label: "Part Name:" },
            { kind: "text", name: "dwgNumber", label: "Dwg. Number:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "dwgRev", label: "Dwg. Rev:" },
            { kind: "date", name: "dwgDate", label: "Dwg. Date:" },
          ],
        },
        { type: "textarea", name: "coreTeam", label: "Core Team:" },
      ],
    },
    {
      number: "2",
      title: "PROCESS STEPS",
      blocks: [
        {
          type: "table",
          name: "steps",
          addableRows: true,
          minRows: 20,
          columns: [
            { key: "opNo", label: "Op. No.", kind: "text" },
            {
              key: "stepType",
              label: "Step Type",
              kind: "select",
              options: ["Operation", "Inspection", "Op / Insp", "Transport", "Delay", "Storage", "Other"],
            },
            { key: "processDescription", label: "Process Description", kind: "textarea" },
            { key: "characteristicNo", label: "Characteristic No.", kind: "text" },
            { key: "outgoing", label: "Outgoing", kind: "checkboxGroup", options: ["Yes"] },
            { key: "controlMethod", label: "Control Method", kind: "text" },
            { key: "description", label: "Description", kind: "textarea" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "APPROVAL",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "preparedBy", label: "Prepared By:" },
            { kind: "date", name: "preparedDate", label: "Date:" },
          ],
        },
        { type: "row", fields: [{ kind: "text", name: "approvedBy", label: "Approved By:" }] },
      ],
    },
  ],
};
