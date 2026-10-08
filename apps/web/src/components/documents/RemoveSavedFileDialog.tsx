import { Modal } from "../modals/Modal";
import type { SavedItemRemoval } from "../../lib/folderDetails";

/** Confirms Remove on a saved upload. The copy states whether the item stays or leaves the folder. */
export function RemoveSavedFileDialog({
  open,
  removal,
  pending,
  onClose,
  onConfirm,
}: {
  open: boolean;
  removal: SavedItemRemoval | null;
  pending?: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal title={removal?.title ?? "Remove file"} isOpen={open} onClose={onClose}>
      <div className="flex flex-col gap-3 text-foreground">
        <p className="text-sm text-foreground">{removal?.body}</p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="confirm-remove-file"
            disabled={pending || removal == null}
            onClick={onConfirm}
            className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground hover:opacity-90 disabled:opacity-60"
          >
            {pending ? "Removing…" : (removal?.confirm ?? "Remove")}
          </button>
          <button type="button" onClick={onClose} disabled={pending} className="rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground hover:bg-muted disabled:opacity-60">
            Cancel
          </button>
        </div>
      </div>
    </Modal>
  );
}
