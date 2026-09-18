import type { FormLayout } from "./types";

/**
 * Full-System Audit finding H3: `audit_checklist` was a real FORM_TYPES
 * entry (services/api's forms.validation.ts) with no layout registered for
 * it at all, so it fell all the way through to the plain key:value fallback
 * on both this on-screen renderer and PDF export — the only form type in
 * the Audits family (audit_plan/lpa both have real structured layouts)
 * left that way.
 *
 * Unlike every sibling layout in this directory, this one is NOT derived
 * from a specific pasted source document — none exists for "Audit
 * Checklist" in this repo. Rather than invent fixed checklist questions and
 * present them as if copied from a real form, this models the general
 * shape every checklist-style audit document in this app already shares
 * (header, a compliance-response table, a findings table, sign-off) and
 * leaves the checklist rows addable/blank, same treatment as Internal
 * Audit Plan's own AGENDA/ATTENDANCE tables for genuinely variable,
 * per-audit content — not a substitute for a real template if/when the
 * user provides one. Kept byte-for-byte identical to services/api's copy
 * (see types.ts's own "keep the two in sync" comment).
 */
const COMPLIANCE_OPTIONS = ["Compliant", "Nonconformity", "N/A"];

export const auditChecklistLayout: FormLayout = {
  formType: "audit_checklist",
  title: "AUDIT CHECKLIST",
  sections: [
    {
      number: "1",
      title: "AUDIT HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "auditTitle", label: "Audit Title:" },
            { kind: "date", name: "auditDate", label: "Audit Date:" },
          ],
        },
        {
          type: "row",
          fields: [
            { kind: "text", name: "areaProcessAudited", label: "Area / Process Audited:" },
            { kind: "text", name: "auditorNames", label: "Auditor(s):" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "CHECKLIST",
      blocks: [
        {
          type: "table",
          name: "checklistItems",
          addableRows: true,
          minRows: 5,
          columns: [
            { key: "question", label: "Audit Question / Requirement", kind: "textarea" },
            { key: "response", label: "Response", kind: "checkboxGroup", options: COMPLIANCE_OPTIONS },
            { key: "evidenceComments", label: "Evidence / Comments", kind: "textarea" },
          ],
        },
      ],
    },
    {
      number: "3",
      title: "FINDINGS / NONCONFORMITIES",
      blocks: [
        {
          type: "table",
          name: "findings",
          addableRows: true,
          minRows: 2,
          columns: [
            { key: "description", label: "Finding Description", kind: "textarea" },
            { key: "correctiveActionRequired", label: "Corrective Action Required", kind: "checkboxGroup", options: ["Yes", "No"] },
            { key: "referenceNcr", label: "Reference NCR #", kind: "text" },
          ],
        },
      ],
    },
    {
      number: "4",
      title: "SIGN-OFF",
      blocks: [
        {
          type: "table",
          name: "signoffs",
          labelColumnHeader: "Role",
          fixedRowLabels: ["Lead Auditor", "Auditee / Area Owner"],
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
