import type { FormLayout } from "./types";

/**
 * Mirrors services/api/src/modules/forms/layouts/calibration.ts. Replaces the
 * old 3-field FORM_FIELD_SPECS fallback (equipment/result/notes) — this is
 * now the single source of truth for a calibration event: saving it also
 * writes a real row into the `calibrations` table (see
 * forms.controller.ts's saveForm), not just a form_data record. Field names
 * here are read directly by that handler, so keep them in sync if either
 * changes. `result` options are lowercase to match the calibrations table's
 * existing stored values (see calibration.controller.ts / EquipmentDetailPage).
 */
export const calibrationLayout: FormLayout = {
  formType: "calibration",
  title: "CALIBRATION RECORD",
  sections: [
    {
      number: "1",
      title: "CALIBRATION EVENT",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "date", name: "performedAt", label: "Date Performed:" },
            { kind: "text", name: "technicianName", label: "Technician Name:", hint: "In-house or the calibration vendor's technician" },
          ],
        },
        {
          type: "row",
          fields: [
            {
              kind: "select",
              name: "result",
              label: "Result:",
              options: ["pass", "fail", "adjusted"],
            },
          ],
        },
        {
          type: "textarea",
          name: "notes",
          label: "Notes:",
          hint: "Any deviations, adjustments made, or observations from this calibration",
        },
      ],
    },
  ],
};
