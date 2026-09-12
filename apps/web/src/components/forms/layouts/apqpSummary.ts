import type { FormLayout } from "./types";

/** Derived 1:1 from the user-provided "APQP Summary.pdf" (Product Quality Planning Summary and Sign-Off). */
export const apqpSummaryLayout: FormLayout = {
  formType: "apqp_summary",
  title: "PRODUCT QUALITY PLANNING SUMMARY AND SIGN-OFF",
  sections: [
    {
      number: "1",
      title: "GENERAL INFORMATION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "productName", label: "Product Name:" },
            { kind: "text", name: "partNumber", label: "Part Number:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "customer", label: "Customer:" },
            { kind: "text", name: "manufacturingPlant", label: "Manufacturing Plant:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "date", label: "Date:" }] },
      ],
    },
    {
      number: "2",
      title: "PRELIMINARY PROCESS CAPABILITY STUDY",
      blocks: [
        {
          type: "table",
          name: "processCapability",
          fixedRowLabels: ["Ppk — Special Characteristics"],
          columns: [
            { key: "required", label: "Required", kind: "number" },
            { key: "acceptable", label: "Acceptable", kind: "number" },
            { key: "pending", label: "Pending*", kind: "number" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "CONTROL PLAN APPROVAL (IF REQUIRED)",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "select", name: "controlPlanApproved", label: "Approved:", options: ["Yes", "No"] },
            { kind: "date", name: "controlPlanApprovedDate", label: "Date Approved:" },
          ],
        },
      ],
    },
    {
      number: "4",
      title: "INITIAL PRODUCTION SAMPLES",
      blocks: [
        {
          type: "table",
          name: "initialProductionSamples",
          labelColumnHeader: "Characteristic Category",
          fixedRowLabels: ["Dimensional", "Visual", "Laboratory", "Performance"],
          columns: [
            { key: "samples", label: "Samples", kind: "number" },
            { key: "characteristics", label: "Characteristics", kind: "text" },
            { key: "acceptable", label: "Acceptable", kind: "number" },
          ],
        },
      ],
    },
    {
      number: "5",
      title: "GAGE AND TEST EQUIPMENT — MEASUREMENT SYSTEM ANALYSIS",
      blocks: [
        {
          type: "table",
          name: "gageTestEquipment",
          fixedRowLabels: ["Special Characteristics"],
          columns: [
            { key: "required", label: "Required", kind: "number" },
            { key: "acceptable", label: "Acceptable", kind: "number" },
            { key: "pending", label: "Pending*", kind: "number" },
          ],
        },
      ],
    },
    {
      number: "6",
      title: "PROCESS MONITORING",
      blocks: [
        {
          type: "table",
          name: "processMonitoring",
          fixedRowLabels: ["Process Monitoring Instructions", "Process Sheets", "Visual Aids"],
          columns: [
            { key: "required", label: "Required", kind: "number" },
            { key: "acceptable", label: "Acceptable", kind: "number" },
            { key: "pending", label: "Pending*", kind: "number" },
          ],
        },
      ],
    },
    {
      number: "7",
      title: "PACKAGING / SHIPPING",
      blocks: [
        {
          type: "table",
          name: "packagingShipping",
          fixedRowLabels: ["Packaging Approval", "Shipping Trials"],
          columns: [
            { key: "required", label: "Required", kind: "number" },
            { key: "acceptable", label: "Acceptable", kind: "number" },
            { key: "pending", label: "Pending*", kind: "number" },
          ],
        },
      ],
    },
    {
      number: "8",
      title: "SIGN-OFF",
      blocks: [
        {
          type: "table",
          name: "signoffs",
          addableRows: true,
          minRows: 6,
          columns: [
            { key: "teamMember", label: "Team Member / Title", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
