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
    { name: "d1_team", label: "D1 — Team", type: "textarea" },
    { name: "d2_problem", label: "D2 — Problem", type: "textarea" },
    { name: "d3_containment", label: "D3 — Containment", type: "textarea" },
    { name: "d4_rootCause", label: "D4 — Root Cause", type: "textarea" },
    { name: "d5_correctiveAction", label: "D5 — Corrective Action", type: "textarea" },
    { name: "d6_implementation", label: "D6 — Implementation", type: "textarea" },
    { name: "d7_prevention", label: "D7 — Prevention", type: "textarea" },
    { name: "d8_closure", label: "D8 — Closure", type: "textarea" },
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
