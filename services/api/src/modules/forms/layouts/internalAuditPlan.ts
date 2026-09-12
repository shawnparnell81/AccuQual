import type { FormLayout } from "./types.js";

/**
 * Derived 1:1 from the user-provided "Internal_Audit_Plan.pdf" — replaces
 * the earlier flat 3-field placeholder registered under formType
 * "audit_plan" (see AuditDetailPage.tsx's "Audit Plan" button).
 */
export const internalAuditPlanLayout: FormLayout = {
  formType: "audit_plan",
  title: "INTERNAL AUDIT PLAN",
  sections: [
    {
      number: "1",
      title: "AUDIT HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "auditTitle", label: "Audit Title:" },
            { kind: "text", name: "auditType", label: "Audit Type:", hint: "e.g. production process, VDA 6.3, new launch, IMS" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "lineNumberProcessName", label: "Line Number and Process Name:" },
            { kind: "text", name: "locationWorkShift", label: "Location / Work Shift:" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "AGENDA",
      blocks: [
        {
          type: "table",
          name: "agenda",
          addableRows: true,
          minRows: 2,
          columns: [
            { key: "scope", label: "Scope", kind: "textarea" },
            { key: "date", label: "Date", kind: "date" },
            { key: "startTime", label: "Start Time", kind: "text" },
            { key: "endTime", label: "End Time", kind: "text" },
            { key: "leadSupportingAuditors", label: "Lead Auditor / Supporting Auditors", kind: "text" },
            { key: "auditees", label: "Auditees", kind: "text" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "ATTENDANCE — OPENING & CLOSING MEETINGS",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "date", name: "openingMeetingDate", label: "Opening Meeting Date:" },
            { kind: "date", name: "closingMeetingDate", label: "Closing Meeting Date:" },
          ],
        },
        {
          type: "table",
          name: "attendance",
          addableRows: true,
          minRows: 10,
          columns: [
            { key: "fullName", label: "Full Name", kind: "text" },
            { key: "meeting", label: "Attended", kind: "checkboxGroup", options: ["Opening", "Closing"] },
          ],
        },
      ],
    },
    {
      number: "4",
      title: "AUDIT METHODS USED",
      blocks: [
        {
          type: "table",
          name: "auditMethods",
          labelColumnHeader: "Method",
          fixedRowLabels: [
            "Conducting an interview with the auditee",
            "Completing checklists/questionnaires with the participation of the auditee",
            "Reviewing documentation together with the auditee",
            "Sampling",
            "Independent review of documentation (e.g., records, data analyses)",
            "Observation of the work performed",
          ],
          columns: [{ key: "applicable", label: "Applicable", kind: "checkboxGroup", options: ["Yes"] }],
        },
        { type: "row", fields: [{ kind: "text", name: "otherAuditMethod", label: "Other method (specify):" }] },
      ],
    },
    {
      number: "5",
      title: "POTENTIAL RISKS FOR THE AUDIT",
      blocks: [
        {
          type: "table",
          name: "auditRisks",
          labelColumnHeader: "Risks to the Audit",
          fixedRowLabels: [
            "Imprecise definition of the audit objective/scope/criteria",
            "Auditors' qualifications not matched to the audit scope",
            "Limited availability of the line team/auditees",
            "Bias of auditors/auditees (lack of objectivity)",
            "Lack of access to information/documents",
            "Risk to the product resulting from auditors' presence in so-called clean areas",
            "Remote audit — technical risks, e.g., network issues",
          ],
          columns: [{ key: "applicable", label: "Applicable", kind: "checkboxGroup", options: ["Yes"] }],
        },
        {
          type: "table",
          name: "areaRisks",
          labelColumnHeader: "Risks to the Audited Area",
          fixedRowLabels: [
            "External threats, e.g., flood",
            "Production risk arising from auditors' presence in clean areas",
            "No production / line breakdowns",
          ],
          columns: [{ key: "applicable", label: "Applicable", kind: "checkboxGroup", options: ["Yes"] }],
        },
      ],
    },
    {
      number: "6",
      title: "RESOURCES",
      blocks: [
        {
          type: "table",
          name: "resources",
          labelColumnHeader: "Resource / PPE",
          fixedRowLabels: [
            "Audit on Production Floor — Protective footwear",
            "Audit on Production Floor — Safety glasses",
            "Audit on Production Floor — ESD smock",
            "Audit in the Warehouse — Protective footwear",
            "Audit in the Warehouse — High-visibility vest",
            "Audit in the Warehouse — Safety helmet (high-bay storage area)",
            "General Audit — Computer and software",
            "General Audit — Meeting rooms",
          ],
          columns: [{ key: "applicable", label: "Applicable", kind: "checkboxGroup", options: ["Yes"] }],
        },
      ],
    },
    {
      number: "7",
      title: "RESPONSIBILITY",
      blocks: [
        {
          type: "textarea",
          name: "responsibilityNotes",
          label: "Role Definitions (reference):",
          hint:
            "Lead auditor — conducts the audit, responsible for the audit area/scope. Supporting auditor — responsible for the " +
            "area/scope assigned by the lead auditor. Observer — responsible for the area/scope assigned by the lead auditor.",
        },
      ],
    },
  ],
};
