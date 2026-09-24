import { useState, type ReactNode } from "react";
import { Navigate, Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { isSession, mfaApi, useLogin, useStartSession, type AuthResponse } from "../../hooks/useAuth";
import { useAuthStore } from "../../store/authStore";
import { TextField } from "../../components/forms/Field";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { StandardsDisclaimer } from "../../components/shared/StandardsDisclaimer";
import { MfaEnrollPanel, RecoveryCodesPanel } from "../../components/auth/MfaPanels";

type Stage =
  | { kind: "password" }
  | { kind: "code"; mfaToken: string }
  | { kind: "enroll"; mfaToken: string }
  | { kind: "codes"; codes: string[]; session: AuthResponse };

function Card({ subtitle, children, onSubmit }: { subtitle: string; children: ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  const inner = (
    <>
      <div className="mb-1 flex items-center gap-3">
        <img src="/branding/logo-mark.png" alt="" className="h-10 w-10 rounded-lg object-cover" />
        <div>
          <h1 className="text-xl font-semibold tracking-wide text-foreground">ACCUQUAL QMS</h1>
          <p className="text-[10px] tracking-widest text-muted-foreground">QUALITY MANAGEMENT SYSTEM</p>
        </div>
      </div>
      <p className="mb-6 mt-3 text-sm text-muted-foreground">{subtitle}</p>
      {children}
    </>
  );
  const cls = "w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm";
  return (
    <div className="flex h-screen items-center justify-center overflow-y-auto bg-background">
      <StandardsDisclaimer className="fixed inset-x-0 bottom-3 px-4 text-center" />
      {onSubmit ? (
        <form onSubmit={onSubmit} className={cls}>
          {inner}
        </form>
      ) : (
        <div className={cls}>{inner}</div>
      )}
    </div>
  );
}

const SSO_ERRORS: Record<string, string> = {
  session_expired: "That single sign-on attempt expired. Please start again.",
  provider_error: "Your identity provider's response couldn't be verified. Please try again, or ask your administrator to check the SSO settings.",
  no_email: "Your identity provider didn't share an email address, so we couldn't match you to an account.",
  email_not_verified: "Your identity provider hasn't confirmed your email address.",
  domain_not_allowed: "Your email domain isn't set up for single sign-on in this organization.",
  email_in_other_organization: "That email address belongs to a different organization.",
  no_account: "You don't have an AccuQual account yet. Ask your administrator to add you.",
  account_disabled: "Your account is deactivated. Contact your administrator.",
  not_configured: "Single sign-on isn't turned on for that organization.",
};

/** Organization code -> the API's SSO start URL (a full-page redirect: the provider's login page is not something to fetch in the background). */
function SsoSignIn() {
  const [open, setOpen] = useState(false);
  const [org, setOrg] = useState("");
  const go = () => {
    if (org.trim()) window.location.href = `${apiClient.defaults.baseURL}/auth/sso/start?tenant=${encodeURIComponent(org.trim())}`;
  };
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="mt-3 w-full rounded-md border border-border py-2 text-sm hover:bg-muted">
        Sign in with single sign-on
      </button>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-2 rounded-md border border-border p-3">
      <TextField
        label="Organization code"
        placeholder="e.g. acme"
        value={org}
        onChange={(e) => setOrg(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault(); // this sits inside the password form — Enter here means "continue with SSO", not "sign in"
            go();
          }
        }}
        autoFocus
      />
      <button
        type="button"
        disabled={!org.trim()}
        onClick={go}
        className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60"
      >
        Continue
      </button>
    </div>
  );
}

const REMEMBERED_EMAIL_KEY = "accuqual-remembered-email";

function readRememberedEmail(): string {
  try {
    return localStorage.getItem(REMEMBERED_EMAIL_KEY) ?? "";
  } catch {
    return "";
  }
}

function storeRememberedEmail(email: string | null) {
  try {
    if (email) localStorage.setItem(REMEMBERED_EMAIL_KEY, email);
    else localStorage.removeItem(REMEMBERED_EMAIL_KEY);
  } catch {
    // Private mode / blocked storage: remembering the email is a convenience, never required.
  }
}

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const ssoError = searchParams.get("sso_error");
  const [email, setEmail] = useState(readRememberedEmail);
  const [remember, setRemember] = useState(() => readRememberedEmail() !== "");
  const [password, setPassword] = useState("");
  const [stage, setStage] = useState<Stage>({ kind: "password" });
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const [codeBusy, setCodeBusy] = useState(false);
  const login = useLogin();
  const startSession = useStartSession();
  const accessToken = useAuthStore((s) => s.accessToken);

  if (accessToken) return <Navigate to="/" replace />;

  function backToPassword() {
    setStage({ kind: "password" });
    setCode("");
    setCodeError(null);
    setPassword("");
  }

  if (stage.kind === "codes") {
    return (
      <Card subtitle="Multi-factor authentication is on">
        <RecoveryCodesPanel codes={stage.codes} onContinue={() => startSession(stage.session)} continueLabel="Continue to AccuQual" />
      </Card>
    );
  }

  if (stage.kind === "enroll") {
    const mfaToken = stage.mfaToken;
    return (
      <Card subtitle="Your organization requires multi-factor authentication. Set it up to finish signing in.">
        <MfaEnrollPanel<AuthResponse>
          start={() => mfaApi.enrollStart(mfaToken)}
          confirm={async (c) => {
            const session = await mfaApi.enrollConfirm(mfaToken, c, remember);
            return { recoveryCodes: session.recoveryCodes ?? [], payload: session };
          }}
          onEnrolled={(codes, session) => setStage({ kind: "codes", codes, session })}
          onCancel={backToPassword}
        />
      </Card>
    );
  }

  if (stage.kind === "code") {
    const mfaToken = stage.mfaToken;
    return (
      <Card
        subtitle="Enter the 6-digit code from your authenticator app."
        onSubmit={async (e) => {
          e.preventDefault();
          setCodeError(null);
          setCodeBusy(true);
          try {
            startSession(await mfaApi.verify(mfaToken, code, remember));
          } catch (err) {
            setCodeError(extractErrorMessage(err, "That code didn't work."));
          } finally {
            setCodeBusy(false);
          }
        }}
      >
        <TextField label="Authentication code" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
        <p className="mt-1 text-xs text-muted-foreground">Lost your phone? Enter one of your recovery codes instead (like ABCDE-FGHIJ).</p>
        {codeError && <p className="mt-3 text-sm text-destructive">{codeError}</p>}
        <button type="submit" disabled={codeBusy} className="mt-6 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {codeBusy ? "Checking…" : "Verify"}
        </button>
        <button type="button" onClick={backToPassword} className="mt-3 w-full text-center text-sm text-muted-foreground hover:text-primary">
          Back to sign in
        </button>
      </Card>
    );
  }

  return (
    <Card
      subtitle="Sign in to your quality management workspace"
      onSubmit={(e) => {
        e.preventDefault();
        storeRememberedEmail(remember ? email : null);
        login.mutate(
          { email, password, rememberMe: remember },
          {
            onSuccess: (data) => {
              if (isSession(data)) return;
              setStage("mfaRequired" in data ? { kind: "code", mfaToken: data.mfaToken } : { kind: "enroll", mfaToken: data.mfaToken });
            },
          }
        );
      }}
    >
      <div className="flex flex-col gap-4">
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div>
          <TextField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          <Link to="/forgot-password" className="mt-1 inline-block text-xs text-muted-foreground hover:text-primary">
            Forgot password?
          </Link>
        </div>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            id="remember-me"
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-form-field accent-[hsl(var(--primary))]"
          />
          <span>
            Remember me
            <span className="block text-xs text-muted-foreground">Stay signed in on this device for 30 days. Only use on a computer you trust.</span>
          </span>
        </label>
      </div>

      {ssoError && <p className="mt-3 text-sm text-destructive">{SSO_ERRORS[ssoError] ?? "Single sign-on didn't complete. Please try again."}</p>}
      {login.isError && <p className="mt-3 text-sm text-destructive">{extractErrorMessage(login.error, "Invalid email or password.").replace(/^Invalid credentials$/, "Invalid email or password.")}</p>}

      <button type="submit" disabled={login.isPending} className="mt-6 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {login.isPending ? "Signing in…" : "Sign in"}
      </button>

      <SsoSignIn />

      <p className="mt-4 text-center text-sm text-muted-foreground">
        No account?{" "}
        <Link to="/register" className="text-primary">
          Register
        </Link>
      </p>
    </Card>
  );
}
