import type { FormField } from "../../types/forms";

/**
 * Default field layout per form type. A company's uploaded custom template
 * would carry its own `fieldMap` (see form_templates.fieldMap) that a real
 * AcroForm-coordinate overlay would read instead — this generic set is what
 * renders until that mapping exists (see Forms & PDF Engine Spec §4).
 */
export const FORM_FIELD_SPECS: Record<string, FormField[]> = {
  ncr: [
    { name: "title", label: "Title" },
    { name: "description", label: "Description", type: "textarea" },
    { name: "severity", label: "Severity" },
    { name: "containment", label: "Containment", type: "textarea" },
    { name: "rootCause", label: "Root Cause", type: "textarea" },
    { name: "correctiveAction", label: "Corrective Action", type: "textarea" },
  ],
  capa: [
    { name: "rootCause", label: "Root Cause", type: "textarea" },
    { name: "actionPlan", label: "Action Plan", type: "textarea" },
    { name: "preventiveAction", label: "Preventive Action", type: "textarea" },
    { name: "verification", label: "Verification", type: "textarea" },
  ],
  eight_d: [
    { name: "customer", label: "Customer:" },
    { name: "address", label: "Address:" },
    { name: "location", label: "Location:" },
    { name: "partNo", label: "Part No./Code" },
    { name: "productName", label: "Product Name:" },
    { name: "dateOpen", label: "Date Open:" },
    { name: "initialResponse", label: "Initial Response:" },
    { name: "targetCloseDate", label: "Target Close Date:" },
    { name: "revisionDates", label: "Revision Date(s):" },
    { name: "actualCloseDate", label: "Actual Close Date:" },
    { name: "customerComplaintNo", label: "Customer Complaint No.:" },
    { name: "initiator", label: "8D Initiator:" },
    { name: "initiatorSupervisor", label: "8D Initiator's Spvr:" },
    { name: "champion", label: "Champion:" },
    { name: "teamLeader", label: "Team Leader:" },
    { name: "teamMembers", label: "Team Members:", type: "textarea" },
    { name: "problemStatement", label: "D2  Problem Statement/Description (quantify) (one defect per 8D):", type: "textarea" },
    { name: "ica", label: "D3  Choose and Verify Interim Containment Action(s) (ICA):", type: "textarea" },
    { name: "icaPercentEffective", label: "% Effective:" },
    { name: "icaTargetDate", label: "Target Date:" },
    { name: "icaActualDate", label: "Actual Date:" },
    { name: "rootCauses", label: "D4 Define and Verify Root Cause(s)", type: "textarea" },
    { name: "rootCausePercentContribution", label: "% Contribution:" },
    { name: "pca", label: "D5  Choose and Verify Permenant Corrective Action(s) (PCA):", type: "textarea" },
    { name: "pcaPercentEffective", label: "% Effective:" },
    { name: "implementation", label: "D6 Implement and Validate Permentant Corrective Action(s) (PCA):", type: "textarea" },
    { name: "implementationTargetDate", label: "Target Date:" },
    { name: "implementationActualDate", label: "Actual Date:" },
    { name: "prevention", label: "D7  System Prevention Actions to Prevent Reoccurence:", type: "textarea" },
    { name: "preventionTargetDate", label: "Target Date:" },
    { name: "preventionActualDate", label: "Actual Date:" },
    { name: "recognition", label: "D8  TEAM AND INDIVIDUAL RECOGNITION:  Recognize the collective efforts of the team.", type: "textarea" },
  ],
  five_why: [
    { name: "problem", label: "Problem Statement", type: "textarea" },
    { name: "why1", label: "Why? (1)", type: "textarea" },
    { name: "why2", label: "Why? (2)", type: "textarea" },
    { name: "why3", label: "Why? (3)", type: "textarea" },
    { name: "why4", label: "Why? (4)", type: "textarea" },
    { name: "why5", label: "Why? (5)", type: "textarea" },
    { name: "rootCause", label: "Root Cause", type: "textarea" },
  ],
  audit_checklist: [
    { name: "auditor", label: "Auditor" },
    { name: "date", label: "Date", type: "date" },
    { name: "findings", label: "Findings", type: "textarea" },
  ],
  audit_plan: [
    { name: "scope", label: "Scope", type: "textarea" },
    { name: "auditor", label: "Auditor" },
    { name: "date", label: "Planned Date", type: "date" },
  ],
  discrepancy_inspection: [
    { name: "description", label: "Discrepancy Description", type: "textarea" },
    { name: "disposition", label: "Disposition", type: "textarea" },
  ],
  supplier: [
    { name: "name", label: "Supplier Name" },
    { name: "notes", label: "Notes", type: "textarea" },
  ],
  change: [
    { name: "description", label: "Change Description", type: "textarea" },
    { name: "impactAssessment", label: "Impact Assessment", type: "textarea" },
  ],
  complaint: [
    { name: "description", label: "Complaint Description", type: "textarea" },
    { name: "resolution", label: "Resolution", type: "textarea" },
  ],
};
