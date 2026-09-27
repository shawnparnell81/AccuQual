import { useState } from "react";
import { Modal } from "../../components/modals/Modal";
import { TextAreaField, TextField } from "../../components/forms/Field";

/**
 * Confirmation for filing a document in Obsolete / Archive, or for an
 * administrator putting one back. Archiving needs a reason plus either the
 * document number/name or an explicit acknowledgement.
 */
export function ObsoleteArchiveDialog({
  open,
  mode,
  documentId,
  documentTitle,
  busy,
  onClose,
  onConfirm,
}: {
  open: boolean;
  mode: "archive" | "restore";
  documentId?: number;
  documentTitle: string;
  busy?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [typed, setTyped] = useState("");
  const [understand, setUnderstand] = useState(false);
  const [reason, setReason] = useState("");

  const needle = typed.trim().toLowerCase();
  const typedMatches =
    (documentId != null && needle === String(documentId)) || (documentTitle.trim() !== "" && needle === documentTitle.trim().toLowerCase());
  const reasonOk = reason.trim().length > 0;
  const archiveOk = mode === "restore" ? understand && reasonOk : (understand || typedMatches) && reasonOk;

  return (
    <Modal
      title={mode === "archive" ? "Move to Obsolete / Archive" : "Restore document"}
      isOpen={open}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!archiveOk || busy) return;
          onConfirm(reason.trim());
        }}
      >
        {mode === "archive" ? (
          <p className="text-sm">
            <span className="font-medium">{documentTitle}</span> becomes read-only. People can still open, preview, download, and print it. It cannot be edited, revised, renamed, or deleted. Only an Owner or Administrator can restore it.
          </p>
        ) : (
          <p className="text-sm">
            <span className="font-medium">{documentTitle}</span> goes back to the folder it came from and can be edited again. This is written to the audit log with your name and the reason below.
          </p>
        )}

        {mode === "archive" && (
          <TextField label="Type the document number or name" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={documentId != null ? String(documentId) : documentTitle} autoComplete="off" />
        )}

        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-0.5" checked={understand} onChange={(e) => setUnderstand(e.target.checked)} />
          <span>{mode === "archive" ? "I understand this document becomes read-only" : "I understand this document will be editable again"}</span>
        </label>

        <TextAreaField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} required maxLength={500} placeholder="Why is this document being moved?" />

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} disabled={busy} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
            Cancel
          </button>
          <button type="submit" disabled={!archiveOk || busy} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {busy ? "Saving…" : mode === "archive" ? "Move to Obsolete / Archive" : "Restore"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
