import { useRef, useState } from "react";
import type { SavedFormMode } from "../../lib/savedFormLock";
import { useConfirm } from "../shared/ConfirmDialog";

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
  saveLocks = false,
}: {
  mode: SavedFormMode;
  canEdit: boolean;
  pending?: boolean;
  /** Module records: Save saves and locks, so there is no separate Done. */
  saveLocks?: boolean;
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
  const confirm = useConfirm();

  async function done() {
    const ok = await confirm({
      title: "Save and lock this record?",
      message: "Done saves your changes, files this record in its Saved Form Folders folder and locks it. Use Edit to change it later.",
      confirmLabel: "Save and lock",
    });
    if (ok) onDone();
  }

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

  if (!canEdit) return <p className="text-sm text-muted-foreground" data-testid="record-read-only">{saveLocks ? "Read only. You don't have edit access to this area." : "This saved form is locked."}</p>;
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
      {saveLocks ? null : <button type="button" data-testid="form-done-editing" onClick={() => void done()} disabled={pending} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground disabled:opacity-60">
        Done
      </button>}
    </>
  );
}

/** Edit / Save / Cancel for a module record. Save saves and locks. Cancel discards and locks. */
export function ModuleFormLock({
  mode,
  canEdit,
  pending,
  session,
  onEdit,
  onSave,
  onLock,
  onCancel,
  onDone,
}: {
  mode: SavedFormMode;
  canEdit: boolean;
  pending?: boolean;
  /** The page's useModuleFormLock result. Save and Cancel are written to the record history through it. */
  session?: { endSession: (action: "save" | "cancel") => void };
  onEdit: () => void | Promise<void>;
  /** Persist the open session. */
  onSave?: () => unknown;
  onLock: () => void;
  /** Cancel discards unsaved changes, then locks. Defaults to onLock. */
  onCancel?: () => void;
  /** Persists any pending drafts, then locks. Used by Save when given. */
  onDone?: () => void;
}) {
  const confirm = useConfirm();
  const [saving, setSaving] = useState(false);
  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      (document.activeElement as HTMLElement | null)?.blur?.();
      if (onDone) {
        onDone();
      } else {
        await Promise.resolve(onSave?.());
        onLock();
      }
      session?.endSession("save");
    } catch {
      // The page shows its own save error and stays open.
    } finally {
      setSaving(false);
    }
  }
  async function cancel() {
    const ok = await confirm({ title: "Discard unsaved changes?", message: "Cancel discards changes you have not saved and locks this record.", confirmLabel: "Discard" });
    if (!ok) return;
    (onCancel ?? onLock)();
    session?.endSession("cancel");
  }
  return <SavedFormLockBar saveLocks mode={mode} canEdit={canEdit} pending={pending || saving} onEdit={onEdit} onSave={() => void save()} onCancel={() => void cancel()} onDone={() => void save()} />;
}
