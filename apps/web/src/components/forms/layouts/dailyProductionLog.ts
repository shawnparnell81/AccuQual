import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the "Daily Production & Quality Log" bundled inside the
 * user-provided "master cal log Template.csv.pdf" (pages 5-8) — a distinct
 * per-shift traceability log from the Master Calibration Log sharing that
 * same source file, so it gets its own form type here.
 */
export const dailyProductionLogLayout: FormLayout = {
  formType: "daily_production_log",
  title: "DAILY PRODUCTION & QUALITY LOG",
  sections: [
    {
      number: "1",
      title: "QMS PROCESS CONTROL & TRACEABILITY RECORD",
      blocks: [
        {
          type: "table",
          name: "entries",
          addableRows: true,
          minRows: 10,
          columns: [
            { key: "date", label: "Date", kind: "date" },
            { key: "shift", label: "Shift", kind: "text" },
            { key: "operatorName", label: "Operator Name", kind: "text" },
            { key: "workOrderJobNumber", label: "Work Order / Job #", kind: "text" },
            { key: "partSkuNumber", label: "Part / SKU Number", kind: "text" },
            { key: "lotBatchNumber", label: "Lot / Batch #", kind: "text" },
            { key: "machineLineId", label: "Machine / Line ID", kind: "text" },
            { key: "targetQty", label: "Target Qty", kind: "number" },
            { key: "actualQtyProduced", label: "Actual Qty Produced", kind: "number" },
            { key: "acceptedQty", label: "Accepted Qty", kind: "number" },
            { key: "rejectedQty", label: "Rejected Qty", kind: "number" },
            { key: "scrapDefectCode", label: "Scrap / Defect Code", kind: "text" },
            { key: "setupApproved", label: "Setup Approved?", kind: "checkboxGroup", options: ["Y"] },
            { key: "inProcessSignOff", label: "In-Process Sign-Off", kind: "text" },
          ],
        },
      ],
    },
  ],
};
