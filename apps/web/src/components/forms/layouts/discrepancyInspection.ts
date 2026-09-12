import type { FormLayout } from "./types";

/**
 * Discrepancy & Inspection investigation — unlike every other layout in this
 * folder, not derived from a user-supplied PDF; there wasn't one for this
 * form type. Structured as a standard Material Review Board-style
 * disposition record, consistent with the real `discrepancy_investigations`
 * table (services/api's drizzle/schema/quality.ts) this attaches to. Most
 * investigations are opened automatically (see audits.controller.ts's
 * addItemHandler) whenever a nonconformance is found on an internal audit;
 * the header fields below get their initial values from that automation and
 * are editable afterward like any other field.
 */
export const discrepancyInspectionLayout: FormLayout = {
  formType: "discrepancy_inspection",
  title: "DISCREPANCY & INSPECTION INVESTIGATION",
  sections: [
    {
      number: "1",
      title: "INVESTIGATION HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "title", label: "Title:" },
            { kind: "select", name: "severity", label: "Severity:", options: ["Minor", "Major", "Critical"] },
          ],
        },
        {
          type: "row",
          fields: [
            {
              kind: "select",
              name: "status",
              label: "Status:",
              options: ["Open", "Investigating", "Disposed", "Closed"],
            },
            { kind: "text", name: "sourceReference", label: "Source (Audit / Finding, if applicable):" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "DISCREPANCY DESCRIPTION",
      blocks: [
        {
          type: "textarea",
          name: "description",
          label: "Discrepancy Description:",
          hint: "What was found, where, and against which requirement/specification",
        },
      ],
    },
    {
      number: "3",
      title: "INVESTIGATION & DISPOSITION",
      blocks: [
        { type: "textarea", name: "containmentAction", label: "Containment Action:" },
        { type: "textarea", name: "rootCause", label: "Root Cause (if determined):" },
        {
          type: "table",
          name: "disposition",
          fixedRowLabels: ["Disposition"],
          columns: [
            {
              key: "value",
              label: "Disposition",
              kind: "checkboxGroup",
              options: ["Use As-Is", "Rework", "Repair", "Scrap", "Return to Supplier", "Sort"],
            },
          ],
        },
        { type: "textarea", name: "dispositionJustification", label: "Disposition Justification:" },
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
          fixedRowLabels: ["Quality Engineer", "MRB Chair"],
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
