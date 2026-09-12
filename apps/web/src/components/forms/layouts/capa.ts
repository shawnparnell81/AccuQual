import type { FormLayout } from "./types";

/**
 * Mirrors services/api/src/modules/forms/layouts/capa.ts — derived 1:1 from
 * the user-provided CAPA_Fillable_Template.pdf. Keep the two in sync.
 */
export const capaLayout: FormLayout = {
  formType: "capa",
  title: "CORRECTIVE AND PREVENTIVE ACTION (CAPA) FORM",
  sections: [
    {
      number: "1",
      title: "GENERAL INFORMATION (CAPA INITIATION)",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "capaNumber", label: "CAPA Number:" },
            { kind: "date", name: "dateInitiated", label: "Date Initiated:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "initiatorName", label: "Initiator Name / Title:" },
            { kind: "text", name: "departmentArea", label: "Department / Area Affected:" },
          ],
        },
        {
          type: "row",
          fields: [
            {
              kind: "text",
              name: "sourceOfIssue",
              label: "Source of Issue:",
              hint: "e.g., Audit, Complaint, Non-Conformance, Deviation",
            },
            {
              kind: "select",
              name: "priorityLevel",
              label: "Priority Level:",
              hint: "Critical / Major / Minor",
              options: ["Critical", "Major", "Minor"],
            },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "PROBLEM DESCRIPTION & FINDINGS",
      blocks: [
        {
          type: "textarea",
          name: "problemDescription",
          label: "Detailed Description of Non-Conformance / Issue:",
          hint: "Describe exactly what happened, when, where, and the immediate impact",
        },
      ],
    },
    {
      number: "3",
      title: "ROOT CAUSE ANALYSIS (RCA)",
      blocks: [
        {
          type: "row",
          fields: [{ kind: "text", name: "rcaMethodology", label: "Methodology Used:", hint: "e.g., 5 Whys, Fishbone, FMEA" }],
        },
        {
          type: "textarea",
          name: "rootCauseFindings",
          label: "Root Cause Findings:",
          hint: "Explain the underlying systematic cause of the issue based on investigation",
        },
      ],
    },
    {
      number: "4",
      title: "ACTION PLAN (CORRECTIVE & PREVENTIVE ACTIONS)",
      blocks: [
        {
          type: "table",
          name: "actionItems",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "description", label: "Action Description", kind: "textarea" },
            { key: "type", label: "Type", kind: "checkboxGroup", options: ["Corrective", "Preventive"] },
            { key: "assignee", label: "Assignee", kind: "text" },
            { key: "dueDate", label: "Due Date", kind: "date" },
          ],
        },
      ],
    },
    {
      number: "5",
      title: "EFFECTIVENESS VERIFICATION",
      blocks: [
        {
          type: "textarea",
          name: "verificationPlan",
          label: "Verification Plan & Criteria:",
          hint: "How will success/effectiveness be measured and when?",
        },
        { type: "textarea", name: "verificationResults", label: "Verification Results & Evidence Summary:" },
        { type: "yesno", name: "effectivenessConfirmed", label: "Is the CAPA successful in preventing recurrence?" },
      ],
    },
    {
      number: "6",
      title: "CLOSURE & SIGN-OFFS",
      blocks: [
        {
          type: "table",
          name: "signoffs",
          fixedRowLabels: ["QA / Compliance Reviewer", "Approving Manager"],
          labelColumnHeader: "Role",
          columns: [
            { key: "name", label: "Name / Title", kind: "text" },
            { key: "signature", label: "Signature", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
