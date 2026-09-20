import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { TextField } from "../../components/forms/Field";
import { StandardsDisclaimer } from "../../components/shared/StandardsDisclaimer";

/** The page the emailed reset link (see auth.service.ts's forgotPassword) actually points at — reads its token from the URL, never stores or displays the raw token itself beyond what's already in the address bar. */
export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") ?? "";
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => (await apiClient.post("/auth/reset-password", { token, newPassword })).data,
    onSuccess: () => navigate("/login", { replace: true }),
    onError: (err) => setError(extractErrorMessage(err, "Couldn't reset your password.")),
  });

  if (!token) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
      <StandardsDisclaimer className="fixed inset-x-0 bottom-3 px-4 text-center" />
        <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 text-center shadow-sm">
          <p className="text-sm text-destructive">This reset link is missing its token — it may have been copied incorrectly.</p>
          <Link to="/forgot-password" className="mt-4 inline-block text-sm text-primary">
            Request a new link
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <StandardsDisclaimer className="fixed inset-x-0 bottom-3 px-4 text-center" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          if (newPassword !== confirmPassword) {
            setError("Passwords don't match.");
            return;
          }
          submit.mutate();
        }}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <h1 className="text-xl font-semibold tracking-wide text-foreground">Set a new password</h1>
        <p className="mb-6 mt-3 text-sm text-muted-foreground">Choose a new password for your account.</p>

        <div className="flex flex-col gap-4">
          <TextField label="New Password" type="password" minLength={12} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
          <p className="text-xs text-muted-foreground">At least 12 characters. Common passwords, and anything containing your email, are refused.</p>
          <TextField label="Confirm New Password" type="password" minLength={12} value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        <button
          type="submit"
          disabled={submit.isPending}
          className="mt-6 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {submit.isPending ? "Saving…" : "Reset Password"}
        </button>
      </form>
    </div>
  );
}
