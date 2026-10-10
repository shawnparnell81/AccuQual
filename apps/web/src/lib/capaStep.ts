export type CapaNarrativeField = "rootCause" | "actionPlan" | "preventiveAction" | "verification";

/**
 * The box for the step the CAPA is on can be typed without unlocking the rest of the form.
 * Start writes the cause. Do the fix writes the plan and whether it worked. Check it keeps that note.
 */
export function capaStepFieldEditable(status: string, field: CapaNarrativeField, permitted: boolean): boolean {
  if (!permitted || status === "closed") return false;
  if (status === "open") return field === "rootCause";
  if (status === "in_progress") return field === "actionPlan" || field === "preventiveAction" || field === "verification";
  if (status === "verifying") return field === "verification";
  return false;
}

/** Trailing whitespace from a rich-text repaint is not an unsaved edit. */
export function textStillDirty(saved: string, draft: string): boolean {
  return saved.replace(/\s+$/g, "") !== draft.replace(/\s+$/g, "");
}
