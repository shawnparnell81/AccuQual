/** A saved form opens locked. Edit unlocks it. Save stays in that session. Done and Cancel lock it again. */
export type SavedFormMode = "locked" | "editing";

export function openSavedForm(fresh = false): SavedFormMode {
  return fresh ? "editing" : "locked";
}

export function isFreshFormOpen(state: unknown): boolean {
  return Boolean(state && typeof state === "object" && (state as { freshForm?: unknown }).freshForm === true);
}

export function afterEditClick(canEdit: boolean): SavedFormMode {
  return canEdit ? "editing" : "locked";
}

/** A save in the current session does not end it. */
export function afterSave(): SavedFormMode {
  return "editing";
}

/** Done, Cancel, leaving the record, and a reload lock the form. */
export function afterSaveOrCancel(): SavedFormMode {
  return "locked";
}

export function savedFieldsEditable(mode: SavedFormMode, canEdit: boolean): boolean {
  return canEdit && mode === "editing";
}
