import type { FormLayout } from "./types.js";

/**
 * Derived 1:1 from the user-provided "Management Review Template.pdf"
 * (Management System Performance Evaluation Record). Modeled as a singleton
 * document (like the Production Logs) rather than a dated series of past
 * reviews — see ManagementSystemPage.tsx for the simplification note.
 */
export const managementReviewLayout: FormLayout = {
  formType: "management_review",
  title: "MANAGEMENT SYSTEM PERFORMANCE EVALUATION RECORD",
  sections: [
    {
      number: "1",
      title: "HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "date", name: "reviewDate", label: "Review Date:" },
            { kind: "text", name: "chairpersonName", label: "Chairperson Name:" },
          ],
        },
        {
          type: "textarea",
          name: "attendanceRoster",
          label: "Attendance Roster:",
          hint: "List all plant managers, quality directors, operations leads",
        },
      ],
    },
    {
      number: "2",
      title: "STRATEGIC CORE REVIEW INPUTS EVALUATION",
      blocks: [
        {
          type: "table",
          name: "reviewInputs",
          labelColumnHeader: "Performance Input Vector",
          fixedRowLabels: ["Customer Feedback & Metrics", "Process Performance & Metrics", "Previous Action Items Check"],
          columns: [{ key: "details", label: "Observed Systemic Status / Trend Analysis Details", kind: "textarea" }],
        },
      ],
    },
    {
      number: "3",
      title: "SYSTEM STRATEGIC OUTPUTS (ACTION ITEMS & RESOURCE ALLOCATION)",
      blocks: [
        {
          type: "table",
          name: "actionItems",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "decision", label: "Strategic Output Decision / Action Node", kind: "textarea" },
            { key: "responsibleOwner", label: "Responsible Owner", kind: "text" },
            { key: "targetDate", label: "Target Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
