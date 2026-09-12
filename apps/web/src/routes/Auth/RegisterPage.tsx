import { useState } from "react";
import { Navigate, Link } from "react-router-dom";
import { useRegister } from "../../hooks/useAuth";
import { useAuthStore } from "../../store/authStore";
import { TextField } from "../../components/forms/Field";

export function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tenantCode, setTenantCode] = useState("");
  const register = useRegister();
  const accessToken = useAuthStore((s) => s.accessToken);

  if (accessToken) return <Navigate to="/" replace />;

  return (
    <div className="flex h-screen items-center justify-center bg-muted">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          register.mutate({ email, password, name, tenantCode });
        }}
        className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm"
      >
        <h1 className="mb-1 text-xl font-semibold text-primary">Join your AccuQual workspace</h1>
        <p className="mb-4 text-sm text-muted-foreground">
          AccuQual is multi-tenant — you're joining an existing company workspace, not creating one. Ask your admin for
          your organization's tenant code.
        </p>

        <div className="flex flex-col gap-4">
          <TextField label="Tenant code" placeholder="e.g. demo" value={tenantCode} onChange={(e) => setTenantCode(e.target.value)} required />
          <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <TextField
            label="Password"
            type="password"
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>

        {register.isError && (
          <p className="mt-3 text-sm text-destructive">Could not register — check the tenant code, or try a different email.</p>
        )}

        <button
          type="submit"
          disabled={register.isPending}
          className="mt-6 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
        >
          {register.isPending ? "Creating account…" : "Create account"}
        </button>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link to="/login" className="text-primary">
            Sign in
          </Link>
        </p>
      </form>
    </div>
  );
}
