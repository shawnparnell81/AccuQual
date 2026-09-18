import type { FormLayout } from "./types";

/**
 * Derived 1:1 from the user-provided "Mnanager Review Minutes Template.pdf"
 * (Executive Governance & System Performance Record). A distinct, more
 * detailed document from the earlier "management_review" formType
 * (Management System Performance Evaluation Record) — both are real,
 * kept as separate documents rather than merged. Modeled as a singleton,
 * same simplification as management_review and staff_meeting_minutes.
 *
 * Full-System Audit finding M10: intentional, current behavior, documented
 * explicitly rather than left implicit. TODO (future versioning, not
 * planned/implemented): see management_review.ts's own TODO — the same
 * per-entityId seam would apply here.
 */
export const managementReviewMinutesLayout: FormLayout = {
  formType: "management_review_minutes",
  title: "EXECUTIVE GOVERNANCE & SYSTEM PERFORMANCE RECORD",
  sections: [
    {
      number: "1",
      title: "HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "reviewSessionRef", label: "Review Session Ref:", hint: "e.g. MR-2026-Q3" },
            { kind: "date", name: "meetingDate", label: "Meeting Date:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "facilitatorChair", label: "Facilitator / Chair:", hint: "Executive / Plant Lead" },
            { kind: "text", name: "recorderScribe", label: "Recorder / Scribe:", hint: "Quality System Custodian" },
          ],
        },
        {
          type: "textarea",
          name: "attendanceMatrix",
          label: "Executive Leadership Attendance Matrix:",
          hint: "List attending managers, roles, and absent stakeholders requiring document briefing sign-off",
        },
      ],
    },
    {
      number: "2",
      title: "STRATEGIC PERFORMANCE INPUT REVIEW MATRICES",
      blocks: [
        {
          type: "table",
          name: "performanceInputs",
          labelColumnHeader: "Core Operational Target Input Area",
          fixedRowLabels: [
            "Audit Performance & System Health",
            "Customer Feedback & Operational Metrics",
            "Process Performance & Product Conformity",
            "Resource Needs, Capacity & Continuous Changes",
          ],
          columns: [
            { key: "review", label: "Data Review, Trends Analysed & Strategic Decisions Taken", kind: "textarea" },
            {
              key: "systemHealthStatus",
              label: "System Health Status",
              kind: "select",
              options: ["Satisfactory / Capable", "Marginal / Watch", "Unsatisfactory / Not Capable"],
            },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "DOWNSTREAM SYSTEMIC ACTIONS & RESOURCE ALLOCATION TRACKING",
      blocks: [
        {
          type: "table",
          name: "actionItems",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "description", label: "Strategic Action Item Description / Target", kind: "textarea" },
            { key: "assignedOwner", label: "Assigned Owner", kind: "text" },
            { key: "targetDate", label: "Target Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
