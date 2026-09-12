import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the user-provided "production_log_template.pdf" (Master
 * Production Log). The source spans 6 PDF pages purely because its table is
 * too wide to print in one column group (Order & Traceability | Planning &
 * Scheduling | Shop Floor Execution & Yield | Quality Control & Shipping,
 * side by side) — here it's one continuous table, and Yield % is computed
 * automatically (Actual Qty Produced / Target Qty) instead of typed in.
 */
export const productionLogLayout: FormLayout = {
  formType: "production_log",
  title: "MASTER PRODUCTION LOG",
  sections: [
    {
      number: "1",
      title: "SHOP-FLOOR FULFILLMENT TRACKER",
      blocks: [
        {
          type: "table",
          name: "workOrders",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "workOrderNumber", label: "Work Order #", kind: "text" },
            { key: "poNumber", label: "PO #", kind: "text" },
            { key: "customerName", label: "Customer Name", kind: "text" },
            { key: "productDescription", label: "Product Description", kind: "textarea" },
            { key: "partSkuNumber", label: "Part / SKU #", kind: "text" },
            { key: "revision", label: "Revision", kind: "text" },
            { key: "orderConfirmDate", label: "Order Confirm Date", kind: "date" },
            { key: "planShipDate", label: "Plan Ship Date", kind: "date" },
            { key: "targetQty", label: "Target Qty", kind: "number" },
            { key: "scheduledLineMc", label: "Scheduled Line/MC", kind: "text" },
            { key: "setupTimeHrs", label: "Setup Time (Hrs)", kind: "number" },
            { key: "actualQtyProduced", label: "Actual Qty Produced", kind: "number" },
            { key: "scrapQty", label: "Scrap Qty", kind: "number" },
            { key: "yieldPercent", label: "Yield %", kind: "computed", formula: "yieldPercent" },
            { key: "actualStartDate", label: "Actual Start Date", kind: "date" },
            { key: "actualEndDate", label: "Actual End Date", kind: "date" },
            { key: "qualitySignOff", label: "Quality Sign-off", kind: "select", options: ["Approved", "Pending Audit", "Rejected"] },
            { key: "ncrHoldRef", label: "NCR / Hold Ref", kind: "text" },
            { key: "shippedQty", label: "Shipped Qty", kind: "number" },
            {
              key: "fulfillmentStatus",
              label: "Fulfillment Status",
              kind: "select",
              options: ["Scheduled", "In Production", "Shipped", "In Transit", "On Hold"],
            },
          ],
        },
      ],
    },
  ],
};
