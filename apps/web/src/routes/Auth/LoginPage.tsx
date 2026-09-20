import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useLogin } from "../../hooks/useAuth";
import { useAuthStore } from "../../store/authStore";
import { TextField } from "../../components/forms/Field";
import { StandardsDisclaimer } from "../../components/shared/StandardsDisclaimer";

export function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const accessToken = useAuthStore((s) => s.accessToken);

  if (accessToken) return <Navigate to="/" replace />;

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <StandardsDisclaimer className="fixed inset-x-0 bottom-3 px-4 text-center" />
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password });
        }}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <div className="mb-1 flex items-center gap-3">
          <img src="/branding/logo-mark.png" alt="" className="h-10 w-10 rounded-lg object-cover" />
          <div>
            <h1 className="text-xl font-semibold tracking-wide text-foreground">ACCUQUAL QMS</h1>
            <p className="text-[10px] tracking-widest text-muted-foreground">QUALITY MANAGEMENT SYSTEM</p>
          </div>
        </div>
        <p className="mb-6 mt-3 text-sm text-muted-foreground">Sign in to your quality management workspace</p>

        <div className="flex flex-col gap-4">
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <div>
            <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            <Link to="/forgot-password" className="mt-1 inline-block text-xs text-muted-foreground hover:text-primary">
              Forgot password?
            </Link>
          </div>
        </div>

        {login.isError && <p className="mt-3 text-sm text-destructive">Invalid email or password.</p>}

        <button
          type="submit"
          disabled={login.isPending}
          className="mt-6 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {login.isPending ? "Signing in…" : "Sign in"}
        </button>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          No account?{" "}
          <Link to="/register" className="text-primary">
            Register
          </Link>
        </p>
      </form>
    </div>
  );
}
