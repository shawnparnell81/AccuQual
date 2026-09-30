import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";
import { StandardsDisclaimer } from "../../components/shared/StandardsDisclaimer";
import { useLogout } from "../../hooks/useAuth";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { useAuthStore } from "../../store/authStore";

/** First sign-in after the account exists: choose the 4-digit PIN used to sign forms. */
export function SetSignaturePinPage() {
  const pinSet = useAuthStore((s) => s.user?.pinSet);
  const navigate = useNavigate();
  const logout = useLogout();
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (pinSet === true) return <Navigate to="/" replace />;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    if (!/^\d{4}$/.test(pin) || pin !== confirmPin) {
      setError("Enter the same 4-digit PIN twice.");
      return;
    }
    setBusy(true);
    try {
      await apiClient.post("/auth/signature-pin", { pin, confirmPin });
      const state = useAuthStore.getState();
      if (state.user && state.accessToken) {
        state.setSession({ ...state.user, pinSet: true }, state.accessToken, state.company);
      }
      setPin("");
      setConfirmPin("");
      navigate("/", { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't save that PIN."));
    } finally {
      setPin("");
      setConfirmPin("");
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center overflow-y-auto bg-background px-4 py-8">
      <StandardsDisclaimer className="fixed inset-x-0 bottom-3 px-4 text-center" />
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl ring-1 ring-primary/10">
        <h1 className="text-xl font-semibold text-foreground">Set your signature PIN</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">
          You need a 4-digit PIN before you can sign a form. It is stored as a hash. Nobody, including an administrator, can read it back.
        </p>
        <form className="flex flex-col gap-3" onSubmit={(event) => void submit(event)}>
          <TextField label="4-digit PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
          <TextField label="Confirm PIN" type="password" inputMode="numeric" autoComplete="off" maxLength={4} value={confirmPin} onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, "").slice(0, 4))} required />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {busy ? "Saving…" : "Save PIN"}
          </button>
        </form>
        <button type="button" onClick={() => logout.mutate()} disabled={logout.isPending} className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-primary">
          Sign out
        </button>
      </div>
    </div>
  );
}
