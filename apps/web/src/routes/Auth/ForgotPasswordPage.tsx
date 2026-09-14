import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";

/** Inspection Report ONB-02/R05 — there was previously no way for a locked-out user to recover their own account. Always shows the same confirmation regardless of whether the email is registered, matching the backend's own deliberately-generic response. */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const submit = useMutation({
    mutationFn: async () => (await apiClient.post("/auth/forgot-password", { email })).data,
    onSuccess: () => setSubmitted(true),
  });

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm">
        <h1 className="text-xl font-semibold tracking-wide text-foreground">Reset your password</h1>

        {submitted ? (
          <>
            <p className="mt-4 text-sm text-muted-foreground">
              If <strong className="text-foreground">{email}</strong> is registered, a password reset link has been sent. Check your
              inbox — the link expires in 30 minutes.
            </p>
            <Link to="/login" className="mt-6 inline-block text-sm text-primary">
              &larr; Back to sign in
            </Link>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit.mutate();
            }}
          >
            <p className="mb-6 mt-3 text-sm text-muted-foreground">Enter your email and we'll send you a link to reset your password.</p>
            <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            <button
              type="submit"
              disabled={submit.isPending}
              className="mt-6 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
            >
              {submit.isPending ? "Sending…" : "Send reset link"}
            </button>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              <Link to="/login" className="text-primary">
                &larr; Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
