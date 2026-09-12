import type { FormLayout } from "./types.js";

/**
 * Derived 1:1 from the user-provided "Monthly Staff Meeting Minutes
 * Template.pdf" (Operational Staff & Cross-Functional Alignment Log).
 * Modeled as a singleton, same simplification as management_review and
 * management_review_minutes.
 */
export const staffMeetingMinutesLayout: FormLayout = {
  formType: "staff_meeting_minutes",
  title: "OPERATIONAL STAFF & CROSS-FUNCTIONAL ALIGNMENT LOG",
  sections: [
    {
      number: "1",
      title: "HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "logReferenceId", label: "Log Reference ID:", hint: "e.g. SM-2026-M09" },
            { kind: "date", name: "meetingDate", label: "Meeting Date:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "meetingLeader", label: "Meeting Leader:", hint: "Plant Supervisor / Lead" },
            { kind: "text", name: "targetFacilityDepartment", label: "Target Facility / Department:", hint: "All Plant Ops / Cross Functional" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "WORKPLACE SAFETY, HEALTH, & ENVIRONMENTAL AUDITING",
      blocks: [
        {
          type: "textarea",
          name: "safetyAuditing",
          label: "Notes:",
          hint: "Log facility safety issues, 5S walkthrough observations, physical equipment conditions",
        },
      ],
    },
    {
      number: "3",
      title: "CORE OPERATIONAL METRICS, SCRAP ANALYSIS, & STATION DOWNTIME",
      blocks: [
        {
          type: "textarea",
          name: "operationalMetrics",
          label: "Notes:",
          hint: "Review monthly shift efficiencies, main causes of line downtime, specific scrap surges",
        },
      ],
    },
    {
      number: "4",
      title: "ACTIVE CUSTOMER QUALITY ALERTS & CONTAINMENT STATUS REVIEWS",
      blocks: [
        {
          type: "textarea",
          name: "qualityAlerts",
          label: "Notes:",
          hint: "Check active Quality Alerts on the shop floor, verify compliance at checking fixtures, review inspector feedback",
        },
      ],
    },
    {
      number: "5",
      title: "STANDARD TRAINING UPDATES, SHIFT BRIEFINGS, & CULTURE INITIATIVES",
      blocks: [
        {
          type: "textarea",
          name: "trainingUpdates",
          label: "Notes:",
          hint: "Operator rotations schedule, work instruction revision awareness, shift briefing validation",
        },
      ],
    },
    {
      number: "6",
      title: "PLANT FLOOR ACTION TASK ASSIGNMENTS",
      blocks: [
        {
          type: "table",
          name: "actionItems",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "description", label: "Immediate Field Corrective / Containment Action Item", kind: "textarea" },
            { key: "assignedTeamLead", label: "Assigned Team Lead", kind: "text" },
            { key: "targetCloseoutDate", label: "Target Closeout Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
