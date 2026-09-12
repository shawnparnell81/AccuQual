import type { FormLayout, TableColumn } from "./types.js";

/**
 * Derived 1:1 from the user-provided "LPA template.pdf" (Layered Process
 * Audit). The source is a 15-question x 5-day x 3-shift compliance grid —
 * built here programmatically instead of hand-typing 15 near-identical day/
 * shift column definitions.
 */
const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"] as const;
const COMPLIANCE_OPTIONS = ["V — Compliant", "X — Nonconformity", "N/A — Not Applicable, No Production"];

const dayShiftColumns: TableColumn[] = DAYS.flatMap((day) =>
  [1, 2, 3].map((shift) => ({
    key: `${day.toLowerCase()}_shift${shift}`,
    label: `${day} — Shift ${shift}`,
    kind: "select" as const,
    options: COMPLIANCE_OPTIONS,
  }))
);

const dayShiftTextColumns: TableColumn[] = DAYS.flatMap((day) =>
  [1, 2, 3].map((shift) => ({
    key: `${day.toLowerCase()}_shift${shift}`,
    label: `${day} — Shift ${shift}`,
    kind: "text" as const,
  }))
);

export const lpaLayout: FormLayout = {
  formType: "lpa",
  title: "LAYERED PROCESS AUDIT (LPA)",
  sections: [
    {
      number: "1",
      title: "AUDIT HEADER",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "text", name: "weekMonthYear", label: "Week Number / Month / Year:" },
            { kind: "text", name: "productionLineName", label: "Number and Production Line Name:" },
          ],
        },
      ],
    },
    {
      number: "2",
      title: "SHIFT / WORKSTATION LOG",
      blocks: [
        {
          type: "table",
          name: "shiftLog",
          labelColumnHeader: "Field",
          fixedRowLabels: ["Workstation Number", "Employee Number Performing Inspection", "Control Date"],
          columns: dayShiftTextColumns,
        },
      ],
    },
    {
      number: "3",
      title: "LAYERED PROCESS AUDIT CHECKLIST",
      blocks: [
        {
          type: "table",
          name: "checklist",
          labelColumnHeader: "Audit Question",
          fixedRowLabels: [
            "1. Do non-conformities have planned implementation dates, and are all activities carried out within the prescribed deadlines?",
            "2. Is the current, approved work instruction available at the workstation, and has the operator been trained on it?",
            "3. Is there a witness of the first good part at the workstation or production line?",
            "4. Does the operator show full knowledge of the work sequence?",
            "5. Are process parameters consistent with the work instruction, and is the production order fully and continuously recorded?",
            "6. Is the workplace in order, with no unnecessary tools, components, or equipment?",
            "7. Are sub-components and final products properly labeled/identified with the appropriate status?",
            "8. Are chemical handling instructions available?",
            "9. Is the employee familiar with the chemical handling instructions, and is it documented?",
            "10. Are instructions for safe machine operation available?",
            "11. Are the control and measurement devices available and up to date?",
            "12. Does the employee know how to deal with a non-conforming product?",
            "13. Is there a designated, properly marked place for non-conforming products, and are final products packed per the packing instructions?",
            "14. Are employees aware of the latest quality and health & safety notifications?",
            "15. Are the cabinets next to the machines closed (no risk of electric shock)?",
          ],
          columns: dayShiftColumns,
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
          fixedRowLabels: ["Shift Manager", "Supervisor", "Plant Manager"],
          columns: [
            { key: "name", label: "Name", kind: "text" },
            { key: "date", label: "Date", kind: "date" },
          ],
        },
      ],
    },
  ],
};
