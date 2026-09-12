import type { FormLayout } from "./types.js";

/**
 * Derived 1:1 from the user-provided "Automotive Non Conformance Report (NCR)
 * Template.pdf" — an 8-section controlled-document NCR, replacing the earlier
 * flat 6-field placeholder. Registering this under formType "ncr" means the
 * existing "Open Form" button on the NCR detail page now renders this real
 * document instead of the old generic fallback.
 */
export const ncrLayout: FormLayout = {
  formType: "ncr",
  title: "NON CONFORMANCE REPORT (NCR)",
  sections: [
    {
      number: "0",
      title: "DOCUMENT CONTROL",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "ncrNumber", label: "NCR Number:" },
            { kind: "text", name: "revision", label: "Revision:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "dateIssued", label: "Date Issued:" }] },
        {
          type: "table",
          name: "documentStatus",
          fixedRowLabels: ["Status"],
          columns: [{ key: "status", label: "Document Status", kind: "checkboxGroup", options: ["Draft", "Active", "Closed"] }],
        },
      ],
    },
    {
      number: "1",
      title: "NCR IDENTIFICATION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "partNumberDescription", label: "Part Number / Description:" },
            { kind: "text", name: "customerSupplierName", label: "Customer / Supplier Name:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "poJobNumber", label: "Purchase Order / Job Number:" },
            { kind: "text", name: "drawingSpecReference", label: "Drawing / Specification Reference:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "number", name: "quantityNonconforming", label: "Quantity Nonconforming:" },
            { kind: "number", name: "totalQuantityInspected", label: "Total Quantity Inspected:" },
          ],
        },
        {
          type: "table",
          name: "detectionPoint",
          fixedRowLabels: ["Detection Point"],
          columns: [
            {
              key: "point",
              label: "Detection Point",
              kind: "checkboxGroup",
              options: ["Incoming Inspection", "In-Process", "Final Inspection", "Customer Return", "Field"],
            },
          ],
        },
        {
          type: "table",
          name: "ncrClassification",
          fixedRowLabels: ["Classification"],
          columns: [{ key: "classification", label: "NCR Classification", kind: "checkboxGroup", options: ["Minor", "Major", "Critical"] }],
        },
        {
          type: "table",
          name: "nonconformanceCategory",
          fixedRowLabels: ["Category"],
          columns: [
            {
              key: "category",
              label: "Nonconformance Category",
              kind: "checkboxGroup",
              options: ["Dimensional", "Material", "Workmanship", "Documentation", "Process", "Other"],
            },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "reportedBy", label: "Reported By (Name / Title):" },
            { kind: "text", name: "department", label: "Department:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "dateReported", label: "Date Reported:" }] },
      ],
    },
    {
      number: "2",
      title: "NONCONFORMANCE DESCRIPTION",
      blocks: [
        {
          type: "textarea",
          name: "nonconformanceDescription",
          label: "Nonconformance Description:",
          hint: "Observed condition vs. required condition, defect location, lot/serial ID, and any measurement data collected",
        },
        { type: "row", fields: [{ kind: "text", name: "referenceStandardViolated", label: "Reference Standard / Requirement Violated:" }] },
        {
          type: "table",
          name: "supportingEvidence",
          fixedRowLabels: ["Supporting Evidence"],
          columns: [{ key: "evidence", label: "Supporting Evidence", kind: "checkboxGroup", options: ["Attached (photos, measurements, test results)", "N/A"] }],
        },
      ],
    },
    {
      number: "3",
      title: "IMMEDIATE CONTAINMENT ACTIONS (ICA)",
      blocks: [
        {
          type: "table",
          name: "containmentActions",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "action", label: "Containment Action Taken", kind: "textarea" },
            { key: "responsible", label: "Responsible Person", kind: "text" },
            { key: "targetDate", label: "Target Date", kind: "date" },
            { key: "completionDate", label: "Completion Date", kind: "date" },
            { key: "status", label: "Status", kind: "checkboxGroup", options: ["Open", "Closed"] },
          ],
        },
        {
          type: "table",
          name: "suspectMaterialDisposition",
          fixedRowLabels: ["Disposition"],
          columns: [
            {
              key: "disposition",
              label: "Suspect Material Disposition",
              kind: "checkboxGroup",
              options: ["Use As-Is (with concession)", "Rework", "Repair", "Scrap", "Return to Supplier", "Sort"],
            },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "concessionDeviationReference", label: "Concession / Deviation Reference (if any):" },
            { kind: "text", name: "containmentVerifiedBy", label: "Containment Verified By:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "containmentVerifiedDate", label: "Containment Verified — Date:" }] },
      ],
    },
    {
      number: "4",
      title: "ROOT CAUSE ANALYSIS (RCA)",
      blocks: [
        {
          type: "table",
          name: "rcaMethod",
          fixedRowLabels: ["Method Used"],
          columns: [{ key: "method", label: "RCA Method Used", kind: "checkboxGroup", options: ["5-Why", "Fishbone (Ishikawa)", "Fault Tree Analysis (FTA)", "8D", "Other"] }],
        },
        {
          type: "table",
          name: "fiveWhyAnalysis",
          labelColumnHeader: "Step",
          fixedRowLabels: ["Why 1 — Problem Statement", "Why 2", "Why 3", "Why 4", "Why 5 — Root Cause Identified"],
          columns: [{ key: "answer", label: "Answer", kind: "textarea" }],
        },
        {
          type: "textarea",
          name: "identifiedRootCauseSummary",
          label: "Identified Root Cause (Summary):",
          hint: "Distinguish the occurrence cause (why it happened) from the escape cause (why it wasn't caught)",
        },
        { type: "textarea", name: "contributingFactorsEscapePoint", label: "Contributing Factors / Escape Point:" },
        {
          type: "row",
          fields: [
            { kind: "text", name: "rcaCompletedBy", label: "RCA Completed By:" },
            { kind: "text", name: "rcaCompletedByTitle", label: "Title:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "rcaCompletedDate", label: "Date:" }] },
      ],
    },
    {
      number: "5",
      title: "CORRECTIVE ACTION PLAN (CAP)",
      blocks: [
        {
          type: "table",
          name: "correctiveActions",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "description", label: "Corrective Action Description", kind: "textarea" },
            { key: "processAffected", label: "Process / System Affected", kind: "text" },
            { key: "owner", label: "Owner (Name / Title)", kind: "text" },
            { key: "targetDate", label: "Target Date", kind: "date" },
            { key: "completionDate", label: "Completion Date", kind: "date" },
            { key: "verificationMethod", label: "Verification Method", kind: "text" },
            { key: "status", label: "Status", kind: "checkboxGroup", options: ["Open", "Closed"] },
          ],
        },
        {
          type: "textarea",
          name: "systemicPrevention",
          label: "Systemic Prevention:",
          hint: "Horizontal deployment actions across similar products/processes/facilities",
        },
        {
          type: "row",
          fields: [{ kind: "text", name: "pokaYokeDescription", label: "Error Proofing (Poka-Yoke) Applied — Description:" }],
        },
        {
          type: "table",
          name: "documentUpdates",
          labelColumnHeader: "Document",
          fixedRowLabels: ["Control Plan Updated", "FMEA Updated", "Work Instructions Updated"],
          columns: [{ key: "status", label: "Status", kind: "checkboxGroup", options: ["Yes", "No", "N/A"] }],
        },
      ],
    },
    {
      number: "6",
      title: "CORRECTIVE ACTION EFFECTIVENESS VERIFICATION",
      blocks: [
        {
          type: "table",
          name: "effectivenessVerification",
          addableRows: true,
          minRows: 3,
          columns: [
            { key: "method", label: "Verification Method", kind: "text" },
            { key: "responsible", label: "Responsible Person", kind: "text" },
            { key: "verificationDate", label: "Verification Date", kind: "date" },
            { key: "resultObservations", label: "Result / Observations", kind: "textarea" },
            { key: "passFail", label: "Pass / Fail", kind: "checkboxGroup", options: ["Pass", "Fail"] },
          ],
        },
        {
          type: "table",
          name: "verificationEvidence",
          fixedRowLabels: ["Evidence"],
          columns: [{ key: "evidence", label: "Verification Evidence", kind: "checkboxGroup", options: ["Re-inspection", "Audit", "Process Monitoring", "Customer Feedback", "Other"] }],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "effectivenessConfirmedBy", label: "Effectiveness Confirmed By:" },
            { kind: "text", name: "effectivenessConfirmedTitle", label: "Title:" },
          ],
        },
        { type: "row", fields: [{ kind: "date", name: "effectivenessConfirmedDate", label: "Date:" }] },
        { type: "yesno", name: "effectivenessConfirmed", label: "Is the corrective action effective in preventing recurrence?" },
      ],
    },
    {
      number: "7",
      title: "CUSTOMER / SUPPLIER NOTIFICATION",
      blocks: [
        {
          type: "table",
          name: "customerSupplierNotified",
          fixedRowLabels: ["Notified"],
          columns: [{ key: "notified", label: "Customer / Supplier Notified", kind: "checkboxGroup", options: ["Yes", "No", "N/A"] }],
        },
        {
          type: "table",
          name: "notificationMethod",
          fixedRowLabels: ["Method"],
          columns: [{ key: "method", label: "Notification Method", kind: "checkboxGroup", options: ["Email", "Phone", "8D Report", "Formal Letter", "Customer Portal"] }],
        },
        {
          type: "row",
          fields: [
            { kind: "date", name: "notificationDate", label: "Notification Date:" },
            { kind: "text", name: "notificationContactName", label: "Contact Name / Title:" },
          ],
        },
        { type: "row", fields: [{ kind: "text", name: "referenceNumber", label: "Reference Number (8D / SCAR / etc.):" }] },
        {
          type: "table",
          name: "customerApprovalRequired",
          fixedRowLabels: ["Approval Required"],
          columns: [
            { key: "required", label: "Customer Approval Required", kind: "checkboxGroup", options: ["Yes", "No"] },
            { key: "approvalReference", label: "Approval Reference", kind: "text" },
          ],
        },
      ],
    },
    {
      number: "8",
      title: "NCR CLOSURE & APPROVAL",
      blocks: [
        {
          type: "table",
          name: "closureApprovals",
          labelColumnHeader: "Role",
          fixedRowLabels: ["Quality Manager", "Operations / Production Manager", "Engineering (if applicable)", "Customer Representative (if required)"],
          columns: [
            { key: "name", label: "Name (Print)", kind: "text" },
            { key: "signature", label: "Signature", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "date", name: "ncrClosureDate", label: "NCR Closure Date:" },
            { kind: "select", name: "finalDispositionConfirmed", label: "Final Disposition Confirmed:", options: ["Yes", "No"] },
          ],
        },
        {
          type: "textarea",
          name: "lessonsLearned",
          label: "Lessons Learned / Knowledge Capture:",
          hint: "How this knowledge will be shared, trained on, or applied to similar products/processes",
        },
        { type: "textarea", name: "relatedDocuments", label: "Related Documents / NCR Cross-References:" },
      ],
    },
  ],
};
