import { useState } from "react";
import { apiClient } from "../../api/client";
import type { AuthResponse } from "../../hooks/useAuth";
import { useAuthStore } from "../../store/authStore";
import { TextField } from "../../components/forms/Field";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

const RULES = "At least 12 characters. Common passwords, and anything containing your email, are refused.";

/** Calls the signed-in password change and keeps this browser's session. */
export async function submitPasswordChange(currentPassword: string, newPassword: string, confirmPassword: string): Promise<void> {
  if (newPassword !== confirmPassword) throw new Error("Those passwords don't match.");
  const data = (await apiClient.post<AuthResponse>("/auth/change-password", { currentPassword, newPassword })).data;
  const existing = useAuthStore.getState().company;
  useAuthStore.getState().setSession(data.user, data.accessToken, data.company === undefined ? existing : data.company);
}

export function ChangePasswordForm({ forced, onChanged }: { forced?: boolean; onChanged?: () => void }) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setBusy(true);
        try {
          await submitPasswordChange(currentPassword, newPassword, confirmPassword);
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          setSuccess("Password changed. Other signed-in browsers have been signed out, and trusted devices will ask for an authenticator code again.");
          onChanged?.();
        } catch (err) {
          setError(err instanceof Error && err.message === "Those passwords don't match." ? err.message : extractErrorMessage(err, "Couldn't change your password."));
        } finally {
          setBusy(false);
        }
      }}
    >
      {forced && <p className="text-sm text-muted-foreground">This password was set for you. Choose your own before you continue. You'll stay signed in on this browser.</p>}
      <TextField label="Current password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
      <TextField label="New password" type="password" autoComplete="new-password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
      <p className="text-xs text-muted-foreground">{RULES}</p>
      <TextField label="Confirm new password" type="password" autoComplete="new-password" minLength={12} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
      {error && <p className="text-sm text-destructive">{error}</p>}
      {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}
      <button type="submit" disabled={busy} className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60 sm:w-fit">
        {busy ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}

/** Settings → Security, beside two-step sign-in and trusted devices. */
export function ChangePasswordSection() {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">Change password</h3>
      <p className="mb-3 mt-1 text-sm text-muted-foreground">This updates the password for the account you're signed in with.</p>
      <ChangePasswordForm />
    </div>
  );
}
