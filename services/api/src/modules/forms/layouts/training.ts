import type { FormLayout } from "./types.js";

/**
 * Mirrors apps/web/src/components/forms/layouts/training.ts. Replaces the
 * old 2-field FORM_FIELD_SPECS fallback — this is now the single source of
 * truth for a training completion: saving it also writes a real row into
 * `training_assignments` (see forms.controller.ts's saveForm/createVersion),
 * not just a form_data record. entityId is a trainingAssignments row (one
 * employee's one assignment), not the course id. Field names here are read
 * directly by that handler, so keep them in sync if either changes.
 */
export const trainingLayout: FormLayout = {
  formType: "training",
  title: "TRAINING RECORD",
  sections: [
    {
      number: "1",
      title: "TRAINING COMPLETION",
      blocks: [
        {
          type: "row",
          fields: [
            { kind: "date", name: "completionDate", label: "Completion Date:" },
            { kind: "text", name: "trainerName", label: "Trainer Name:", hint: "In-house or an outside training provider" },
          ],
        },
        {
          type: "textarea",
          name: "notes",
          label: "Notes:",
          hint: "Topics covered, assessment results, or other observations",
        },
      ],
    },
  ],
};
