import { useState } from "react";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

/** Settings → Security. Changing the PIN requires the current one. The new PIN is not shown after it is saved. */
export function SignaturePinSection() {
  const [currentPin, setCurrentPin] = useState("");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function digits(value: string) {
    return value.replace(/\D/g, "").slice(0, 4);
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">Signature PIN</h3>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">
        Forms ask for this 4-digit PIN when you sign. It is stored as a hash. An administrator cannot look it up.
      </p>
      <form
        className="flex flex-col gap-3"
        onSubmit={async (event) => {
          event.preventDefault();
          setError(null);
          setSuccess(null);
          if (!/^\d{4}$/.test(currentPin) || !/^\d{4}$/.test(pin) || pin !== confirmPin) {
            setError("Enter your current PIN, then the same new 4-digit PIN twice.");
            return;
          }
          setBusy(true);
          try {
            await apiClient.post("/auth/signature-pin/change", { currentPin, pin, confirmPin });
            setCurrentPin("");
            setPin("");
            setConfirmPin("");
            setSuccess("Signature PIN changed.");
          } catch (err) {
            setError(extractErrorMessage(err, "Couldn't change your signature PIN."));
          } finally {
            setCurrentPin("");
            setPin("");
            setConfirmPin("");
            setBusy(false);
          }
        }}
      >
        <TextField label="Current PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={currentPin} onChange={(e) => setCurrentPin(digits(e.target.value))} required />
        <TextField label="New PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(digits(e.target.value))} required />
        <TextField label="Confirm new PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(digits(e.target.value))} required />
        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}
        <button type="submit" disabled={busy} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:w-fit">
          {busy ? "Saving…" : "Change PIN"}
        </button>
      </form>
    </div>
  );
}
