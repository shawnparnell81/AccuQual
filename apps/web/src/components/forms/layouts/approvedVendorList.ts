import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the user-provided "Approved Vendor List Template.pdf".
 * Performance Score is computed automatically from Defect Rate (PPM) and
 * Delivery Performance (%) — see formulas.ts's `avlPerformanceScore` for the
 * exact tier rule (confirmed with the user): Approved requires PPM<=25 AND
 * Delivery>=98%; Conditional is PPM<=100 OR Delivery>=95%; otherwise Disqualified.
 */
export const approvedVendorListLayout: FormLayout = {
  formType: "approved_vendor_list",
  title: "APPROVED SUPPLIER EVALUATION LOG",
  sections: [
    {
      number: "1",
      title: "SUPPLIER PERFORMANCE ANALYTICS TABLE",
      blocks: [
        {
          type: "table",
          name: "vendors",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "vendorCode", label: "Vendor Code", kind: "text" },
            { key: "supplierName", label: "Supplier Name", kind: "text" },
            { key: "materialCategory", label: "Material Category", kind: "text" },
            { key: "defectRatePpm", label: "Defect Rate (PPM)", kind: "number" },
            { key: "deliveryPerformancePct", label: "Delivery Performance (%)", kind: "number" },
            { key: "auditDate", label: "Audit Date", kind: "date" },
            { key: "performanceScore", label: "Performance Score", kind: "computed", formula: "avlPerformanceScore" },
            {
              key: "approvalStatus",
              label: "Approval Status",
              kind: "select",
              options: ["Approved", "Conditional", "Disqualified", "Pending Review"],
            },
          ],
        },
      ],
    },
  ],
};
