import { useDialogBehavior } from "../../components/shared/useDialogBehavior";

/** What the confirm dialog says. It names the month and what goes with it. */
export function deleteReportMessage(monthLabel: string): string {
  return `Delete the ${monthLabel} Monthly Quality Report? This removes the typed text, imported supplier data, NCR table rows and pictures for that month.`;
}

/** A plain confirm that names the month before its report is deleted. Who deleted it and when go to the audit trail. */
export function DeleteReportDialog({ monthLabel, pending, error, onCancel, onConfirm }: { monthLabel: string; pending: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const ref = useDialogBehavior(true, onCancel);
  return (
    <>
      <div className="qe-no-print fixed inset-0 z-50 bg-black/40" onClick={onCancel} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="qe-delete-title"
        aria-describedby="qe-delete-message"
        tabIndex={-1}
        className="qe-no-print modal-in fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-xl outline-none"
      >
        <h2 id="qe-delete-title" className="text-sm font-medium">
          Delete report
        </h2>
        <p id="qe-delete-message" className="mt-2 text-sm text-muted-foreground">
          {deleteReportMessage(monthLabel)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Claims, NCRs, first articles and the other live data in this report come from other modules and are not touched.</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={pending} className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground disabled:opacity-60" onClick={onConfirm}>
            {pending ? "Deleting…" : "Delete report"}
          </button>
        </div>
      </div>
    </>
  );
}

/** What the verify dialog says: verifying is final and removes the month's raw imported rows. */
export function verifyReportMessage(monthLabel: string): string {
  return `Verify the ${monthLabel} Monthly Quality Report? This deletes that month's raw imported source rows and keeps only its monthly totals for later trend tables. It cannot be undone.`;
}

/** A plain confirm before a month is verified. Who verified, when and what was deleted go to the audit trail. */
export function VerifyReportDialog({ monthLabel, pending, error, onCancel, onConfirm }: { monthLabel: string; pending: boolean; error: string | null; onCancel: () => void; onConfirm: () => void }) {
  const ref = useDialogBehavior(true, onCancel);
  return (
    <>
      <div className="qe-no-print fixed inset-0 z-50 bg-black/40" onClick={onCancel} />
      <div
        ref={ref}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="qe-verify-title"
        aria-describedby="qe-verify-message"
        tabIndex={-1}
        className="qe-no-print modal-in fixed left-1/2 top-24 z-50 w-full max-w-md -translate-x-1/2 rounded-lg border border-border bg-card p-4 shadow-xl outline-none"
      >
        <h2 id="qe-verify-title" className="text-sm font-medium">
          Verify report
        </h2>
        <p id="qe-verify-message" className="mt-2 text-sm text-muted-foreground">
          {verifyReportMessage(monthLabel)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">Uploaded workbooks are never stored, so there are no files to remove. The deletion is recorded in the audit trail.</p>
        {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
        <div className="mt-3 flex justify-end gap-2">
          <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" disabled={pending} className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60" onClick={onConfirm}>
            {pending ? "Verifying…" : "Verify report"}
          </button>
        </div>
      </div>
    </>
  );
}
