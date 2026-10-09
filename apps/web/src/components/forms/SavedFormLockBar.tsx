import type { SavedFormMode } from "../../lib/savedFormLock";

/** Edit, Save, Cancel, and Done for a saved form that opens locked. */
export function SavedFormLockBar({
  mode,
  canEdit,
  pending,
  onEdit,
  onSave,
  onCancel,
  onDone,
}: {
  mode: SavedFormMode;
  canEdit: boolean;
  pending?: boolean;
  onEdit: () => void;
  onSave: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  if (!canEdit) return <p className="text-sm text-muted-foreground">This saved form is locked.</p>;
  if (mode !== "editing") {
    return (
      <button type="button" data-testid="form-edit" onClick={onEdit} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground">
        Edit
      </button>
    );
  }
  return (
    <>
      <button type="button" data-testid="form-save" onClick={onSave} disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60">
        {pending ? "Saving…" : "Save"}
      </button>
      <button type="button" data-testid="form-cancel-edit" onClick={onCancel} disabled={pending} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60">
        Cancel
      </button>
      <button type="button" data-testid="form-done-editing" onClick={onDone} disabled={pending} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60">
        Done
      </button>
    </>
  );
}

/** Edit / Save / Cancel / Done for a module record. Save, Cancel, and Done all lock it. */
export function ModuleFormLock({
  mode,
  canEdit,
  onEdit,
  onLock,
}: {
  mode: SavedFormMode;
  canEdit: boolean;
  onEdit: () => void;
  onLock: () => void;
}) {
  return <SavedFormLockBar mode={mode} canEdit={canEdit} onEdit={onEdit} onSave={onLock} onCancel={onLock} onDone={onLock} />;
}
