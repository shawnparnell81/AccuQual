import { Navigate, useNavigate } from "react-router-dom";
import { ChangePasswordForm } from "../Settings/ChangePasswordSection";
import { useLogout } from "../../hooks/useAuth";
import { useAuthStore } from "../../store/authStore";
import { StandardsDisclaimer } from "../../components/shared/StandardsDisclaimer";

/** Shown after a temporary password (and after MFA, when the account uses it) until a new password is saved. */
export function ForcePasswordChangePage() {
  const mustChange = useAuthStore((s) => s.user?.mustChangePassword);
  const navigate = useNavigate();
  const logout = useLogout();

  if (!mustChange) return <Navigate to="/" replace />;

  return (
    <div className="flex min-h-screen items-center justify-center overflow-y-auto bg-background px-4 py-8">
      <StandardsDisclaimer className="fixed inset-x-0 bottom-3 px-4 text-center" />
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl ring-1 ring-primary/10">
        <h1 className="text-xl font-semibold text-foreground">Set a new password</h1>
        <p className="mb-6 mt-2 text-sm text-muted-foreground">You need to do this before you can open anything else.</p>
        <ChangePasswordForm forced onChanged={() => navigate("/", { replace: true })} />
        <button
          type="button"
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
          className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-primary"
        >
          Sign out
        </button>
      </div>
    </div>
  );
}
