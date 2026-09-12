import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useLogin } from "../../hooks/useAuth";
import { useAuthStore } from "../../store/authStore";
import { TextField } from "../../components/forms/Field";

export function LoginPage() {
  const [email, setEmail] = useState("admin@accuqual.local");
  const [password, setPassword] = useState("");
  const login = useLogin();
  const accessToken = useAuthStore((s) => s.accessToken);

  if (accessToken) return <Navigate to="/" replace />;

  return (
    <div className="flex h-screen items-center justify-center bg-muted">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          login.mutate({ email, password });
        }}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <h1 className="mb-1 text-xl font-semibold text-primary">AccuQual</h1>
        <p className="mb-6 text-sm text-muted-foreground">Sign in to your quality management workspace</p>

        <div className="flex flex-col gap-4">
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
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
