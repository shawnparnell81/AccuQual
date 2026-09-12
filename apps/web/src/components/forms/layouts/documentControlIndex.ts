import type { FormLayout } from "./types";

/**
 * Derived 1:1 from Part B ("Document Control Master Index") of the
 * user-provided "Competency Framework_Doc Control Template.pdf" — Part A
 * (Operator Station Competency Matrix) is a distinct document, see
 * competencyMatrix.ts.
 */
export const documentControlIndexLayout: FormLayout = {
  formType: "document_control_index",
  title: "DOCUMENT CONTROL MASTER INDEX",
  sections: [
    {
      number: "1",
      title: "MASTER INDEX",
      blocks: [
        {
          type: "table",
          name: "documents",
          addableRows: true,
          minRows: 10,
          columns: [
            { key: "documentIdCode", label: "Document ID Code", kind: "text" },
            { key: "documentTitle", label: "Document Operational Title", kind: "textarea" },
            { key: "currentRevisionLevel", label: "Current Revision Level", kind: "text" },
            { key: "effectiveDeploymentDate", label: "Effective Deployment Date", kind: "date" },
            { key: "nextMandatedReviewDate", label: "Next Mandated Review Date", kind: "date" },
            { key: "accessPathGroup", label: "Access Path Group", kind: "text" },
            {
              key: "systemicControlStatus",
              label: "Systemic Control Status",
              kind: "select",
              options: ["Released", "Under Revision", "Obsolete", "Withdrawn"],
            },
          ],
        },
      ],
    },
  ],
};
