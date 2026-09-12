import type { FormLayout } from "./types";

/**
 * Derived 1:1 from Part A ("Operator Station Competency Verification
 * Matrix") of the user-provided "Competency Framework_Doc Control
 * Template.pdf" — Part B (Document Control Master Index) is a distinct
 * document, see documentControlIndex.ts. Total Qualification % is computed
 * automatically from the 4 station levels (0-4 scale each).
 */
export const competencyMatrixLayout: FormLayout = {
  formType: "competency_matrix",
  title: "OPERATOR STATION COMPETENCY VERIFICATION MATRIX",
  sections: [
    {
      number: "1",
      title: "COMPETENCY MATRIX",
      blocks: [
        {
          type: "textarea",
          name: "scaleNote",
          label: "Proficiency Scale (0-4):",
          hint: "0 = Not Qualified, 1 = Trained, 2 = Supervised, 3 = Independent, 4 = Expert",
        },
        {
          type: "table",
          name: "operators",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "employeeId", label: "Employee ID", kind: "text" },
            { key: "operatorFullName", label: "Operator Full Name", kind: "text" },
            { key: "station10Level", label: "Station 10 (Milling)", kind: "number", min: 0, max: 4 },
            { key: "station20Level", label: "Station 20 (Assembly)", kind: "number", min: 0, max: 4 },
            { key: "station30Level", label: "Station 30 (Testing)", kind: "number", min: 0, max: 4 },
            { key: "station40Level", label: "Station 40 (Packing)", kind: "number", min: 0, max: 4 },
            { key: "totalQualificationPct", label: "Total Qualification (%)", kind: "computed", formula: "competencyQualificationPercent" },
          ],
        },
      ],
    },
  ],
};
