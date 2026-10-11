import { useRef, useState } from "react";
import type { SavedFormMode } from "../../lib/savedFormLock";

/** Edit, Save, Cancel, and Done for a saved form that opens locked. */
export function SavedFormLockBar({
  mode,
  canEdit,
  pending,
  opening = false,
  onEdit,
  onSave,
  onCancel,
  onDone,
}: {
  mode: SavedFormMode;
  canEdit: boolean;
  pending?: boolean;
  /** True while begin-edit is still running, including a second click in that time. */
  opening?: boolean;
  onEdit: () => void | Promise<void>;
  onSave: () => void;
  onCancel: () => void;
  onDone: () => void;
}) {
  const openingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const showOpening = opening || busy;

  async function edit() {
    if (showOpening || openingRef.current || mode === "editing") return;
    openingRef.current = true;
    setBusy(true);
    try {
      await onEdit();
    } finally {
      openingRef.current = false;
      setBusy(false);
    }
  }

  if (!canEdit) return <p className="text-sm text-muted-foreground">This saved form is locked.</p>;
  if (mode !== "editing") {
    return (
      <button type="button" data-testid="form-edit" onClick={() => void edit()} disabled={showOpening} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60">
        {showOpening ? "Opening…" : "Edit"}
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

/** Edit / Save / Cancel / Done for a module record. Save keeps editing. Cancel and Done lock it. */
export function ModuleFormLock({
  mode,
  canEdit,
  pending,
  onEdit,
  onSave,
  onLock,
  onCancel,
  onDone,
}: {
  mode: SavedFormMode;
  canEdit: boolean;
  pending?: boolean;
  onEdit: () => void | Promise<void>;
  /** Persist the open session. Does not lock. */
  onSave?: () => void;
  onLock: () => void;
  /** Cancel discards unsaved changes, then locks. Defaults to onLock. */
  onCancel?: () => void;
  /** Done persists any pending drafts, then locks. Defaults to onLock. */
  onDone?: () => void;
}) {
  return <SavedFormLockBar mode={mode} canEdit={canEdit} pending={pending} onEdit={onEdit} onSave={() => onSave?.()} onCancel={onCancel ?? onLock} onDone={onDone ?? onLock} />;
}
