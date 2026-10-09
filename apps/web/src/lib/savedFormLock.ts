/** A saved form opens locked. Edit unlocks it. Save, Cancel, and Done lock it again. */
export type SavedFormMode = "locked" | "editing";

export function openSavedForm(): SavedFormMode {
  return "locked";
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
