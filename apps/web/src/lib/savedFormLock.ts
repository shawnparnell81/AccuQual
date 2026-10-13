/** A saved form opens locked. Edit unlocks it. Save stays in that session. Done and Cancel lock it again. */
export type SavedFormMode = "locked" | "editing";

export function openSavedForm(fresh = false): SavedFormMode {
  return fresh ? "editing" : "locked";
}

export function isFreshFormOpen(state: unknown): boolean {
  return Boolean(state && typeof state === "object" && (state as { freshForm?: unknown }).freshForm === true);
}

/**
 * A form opens editable when it is brand new: either router state says so, or it is an unsaved draft
 * (no record id yet). Router state is empty inside workspace tabs, so a draft must not depend on it.
 */
export function opensFresh(state: unknown, unsavedDraft: boolean): boolean {
  return unsavedDraft || isFreshFormOpen(state);
}

/** What Edit does: an unsaved draft needs no begin-edit call; a saved record does. */
export function editClickAction(canEdit: boolean, mode: SavedFormMode, unsavedDraft: boolean): "none" | "unlock" | "begin-edit" {
  if (!canEdit || mode === "editing") return "none";
  return unsavedDraft ? "unlock" : "begin-edit";
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
