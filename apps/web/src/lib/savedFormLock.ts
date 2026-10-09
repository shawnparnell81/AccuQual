/** A saved form opens locked. Edit unlocks it. Save, Cancel, and Done lock it again. */
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

export function afterSaveOrCancel(): SavedFormMode {
  return "locked";
}

export function savedFieldsEditable(mode: SavedFormMode, canEdit: boolean): boolean {
  return canEdit && mode === "editing";
}
