import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the user-provided "Production Output Log.pdf" (Production
 * & Operational Output Log) — an hourly tracking matrix, distinct from the
 * work-order-based Master Production Log and the per-shift Daily Production
 * & Quality Log built earlier. Net Yield is computed automatically: Actual
 * Gross Produced - Scrap Quantity.
 */
export const productionOutputLogLayout: FormLayout = {
  formType: "production_output_log",
  title: "PRODUCTION & OPERATIONAL OUTPUT LOG",
  sections: [
    {
      number: "1",
      title: "HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "date", name: "date", label: "Date:" },
            { kind: "text", name: "workCellLine", label: "Work Cell / Line:" },
          ],
        },
        {
          type: "row",
          fields: [{ kind: "select", name: "shift", label: "Shift:", options: ["Shift A", "Shift B", "Shift C"] }],
        },
      ],
    },
    {
      number: "2",
      title: "HOURLY TRACKING MATRIX",
      blocks: [
        {
          type: "table",
          name: "hours",
          addableRows: true,
          minRows: 8,
          columns: [
            { key: "hourBlock", label: "Hour Block", kind: "text" },
            { key: "targetYield", label: "Target Yield", kind: "number" },
            { key: "actualGrossProduced", label: "Actual Gross Produced", kind: "number" },
            { key: "scrapQuantity", label: "Scrap Quantity", kind: "number" },
            { key: "defectBreakdown", label: "Defect Breakdown / Cause", kind: "textarea" },
            { key: "operatorInitial", label: "Operator Initial", kind: "text" },
            { key: "netYield", label: "Net Yield", kind: "computed", formula: "netYield" },
          ],
        },
      ],
    },
  ],
};
