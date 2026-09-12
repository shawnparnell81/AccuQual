import type { FormLayout } from "./types.js";

/**
 * Export-only layout for formType "pareto_chart" — see gageRR.ts's comment
 * for why: the on-screen editor is a bespoke component
 * (customForms/ParetoChartForm.tsx) because sort order and cumulative % are
 * whole-table computations, not row-by-row. This layout just prints the raw
 * (description, quantity) rows that component persists into `data.problems`
 * — the sorted order and cumulative % are a live, on-screen-only view and
 * aren't themselves persisted, so they aren't reproduced in the PDF.
 */
export const paretoChartLayout: FormLayout = {
  formType: "pareto_chart",
  title: "PARETO CHART",
  sections: [
    {
      number: "1",
      title: "PROBLEM DESCRIPTION & QUANTITY",
      blocks: [
        {
          type: "table",
          name: "problems",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "description", label: "Problem Description", kind: "textarea" },
            { key: "quantity", label: "Quantity", kind: "number" },
          ],
        },
      ],
    },
  ],
};
