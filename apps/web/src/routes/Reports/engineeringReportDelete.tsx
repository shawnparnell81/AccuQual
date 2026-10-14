import { useState } from "react";
import { useDialogBehavior } from "../../components/shared/useDialogBehavior";

/** What the confirm dialog says. It names the month and what goes with it. */
export function deleteReportMessage(monthLabel: string): string {
  return `Delete the ${monthLabel} Monthly Quality Report? This removes the typed text, imported supplier data, NCR table rows and pictures for that month.`;
}

export function isFourDigitPin(value: string): boolean {
  return /^\d{4}$/.test(value);
}

/** Asks for the person's 4-digit signature PIN before a month's report is deleted. */
export function DeleteReportDialog({
  monthLabel,
  pending,
  error,
  onCancel,
  onConfirm,
}: {
  monthLabel: string;
  pending: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
}) {
  const ref = useDialogBehavior(true, onCancel);
  const [pin, setPin] = useState("");
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
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (isFourDigitPin(pin) && !pending) onConfirm(pin);
          }}
        >
          <label className="flex flex-col gap-1 text-sm">
            Your 4-digit PIN
            <input
              id="qe-delete-pin"
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={4}
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, ""))}
              className="w-32 rounded-md border border-border bg-background px-2 py-1.5 text-sm"
            />
          </label>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!isFourDigitPin(pin) || pending}
              className="rounded-md bg-destructive px-3 py-1.5 text-sm text-destructive-foreground disabled:opacity-60"
            >
              {pending ? "Deleting…" : "Delete report"}
            </button>
          </div>
        </form>
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
