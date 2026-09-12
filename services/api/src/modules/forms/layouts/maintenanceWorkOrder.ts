import type { FormLayout } from "./types.js";

/**
 * Derived 1:1 from the user-provided "Maintenance Work Order Template.pdf"
 * (Asset Maintenance Work Order). Total Cost Metrics is computed
 * automatically: (Estimated Labor Hours x Hourly Labor Rate) + Replacement
 * Parts Cost.
 */
export const maintenanceWorkOrderLayout: FormLayout = {
  formType: "maintenance_work_order",
  title: "ASSET MAINTENANCE WORK ORDER",
  sections: [
    {
      number: "1",
      title: "HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "workOrderNumber", label: "Work Order Number:" },
            {
              kind: "select",
              name: "assetPriority",
              label: "Asset Priority:",
              options: ["Emergency / Line Down", "High", "Medium", "Low / Routine"],
            },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "assetIdCode", label: "Asset ID Code:" },
            { kind: "text", name: "assetLocationBay", label: "Asset Location / Bay:" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "PROBLEM STATEMENT & SAFETY PRE-CHECKS",
      blocks: [
        { type: "textarea", name: "faultSymptoms", label: "Fault Symptoms:", hint: "e.g. Spindle bearing heating or erratic hydraulic fluctuations" },
        {
          type: "table",
          name: "safetyChecklist",
          fixedRowLabels: ["Safety Checklist"],
          columns: [
            {
              key: "items",
              label: "Mandatory Safety Checklist",
              kind: "checkboxGroup",
              options: ["Lock-Out / Tag-Out (LOTO) Verified", "Fluid Lines Depressurized"],
            },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "COST METRICS ESTIMATION FRAMEWORK",
      blocks: [
        {
          // A single-row table, not separate row fields: the computed Total
          // Cost formula only sees columns within its own table row, so the
          // 3 inputs it reads have to live in that same row.
          type: "table",
          name: "costMetrics",
          fixedRowLabels: ["Cost Metrics"],
          columns: [
            { key: "estimatedLaborHours", label: "Estimated Labor Hours", kind: "number" },
            { key: "hourlyLaborRate", label: "Hourly Labor Rate ($)", kind: "number" },
            { key: "replacementPartsCost", label: "Replacement Parts Cost ($)", kind: "number" },
            { key: "totalCostMetrics", label: "Total Cost Metrics ($)", kind: "computed", formula: "maintenanceTotalCost" },
          ],
        },
      ],
    },
    {
      number: "4",
      title: "RESOLUTION VERIFICATION SIGN-OFF",
      blocks: [
        { type: "textarea", name: "technicianActions", label: "Technician Actions:", hint: "e.g. Flushed lines, swapped bearings, recalibrated parameters" },
        { type: "row", fields: [{ kind: "text", name: "signOffAuthority", label: "Sign-off Authority (Ops/Quality):" }] },
      ],
    },
  ],
};
