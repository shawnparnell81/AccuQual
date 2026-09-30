import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Navigate, Link, useSearchParams } from "react-router-dom";
import { apiClient } from "../../api/client";
import { isSession, mfaApi, useLogin, useStartSession, type AuthResponse } from "../../hooks/useAuth";
import { useAuthStore } from "../../store/authStore";
import { TextField } from "../../components/forms/Field";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { StandardsDisclaimer } from "../../components/shared/StandardsDisclaimer";
import { MfaEnrollPanel, RecoveryCodesPanel } from "../../components/auth/MfaPanels";
import { DmaLogo, ProductLine } from "../../components/brand/DmaLogo";

type Stage =
  | { kind: "password" }
  | { kind: "code"; mfaToken: string }
  | { kind: "enroll"; mfaToken: string }
  | { kind: "codes"; codes: string[]; session: AuthResponse };

function Card({ subtitle, children, onSubmit }: { subtitle: string; children: ReactNode; onSubmit?: (e: React.FormEvent) => void }) {
  const inner = (
    <>
      <div className="mb-5 flex flex-col items-center gap-3 text-center">
        <DmaLogo height={72} />
        <h1>
          <ProductLine className="aq-product-line-signin" />
        </h1>
      </div>
      <p className="mb-6 mt-3 text-sm text-muted-foreground">{subtitle}</p>
      {children}
    </>
  );
  const cls = "w-full max-w-sm rounded-2xl border border-border bg-card p-6 shadow-2xl ring-1 ring-primary/10";
  // The card grows with its contents so a short window can scroll to the trust checkbox instead of clipping it.
  return (
    <div className="flex min-h-screen items-center justify-center overflow-y-auto px-4 py-8 pb-16">
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
  not_configured: "Single sign-on isn't turned on.",
};

/** Shown only when the company has turned single sign-on on. A full-page redirect: the provider's login page is not something to fetch in the background. */
function SsoSignIn() {
  const { data } = useQuery<{ enabled: boolean; displayName: string | null }>({
    queryKey: ["sso/discover"],
    queryFn: async () => (await apiClient.get("/auth/sso/discover")).data,
    staleTime: 5 * 60_000,
  });
  if (!data?.enabled) return null;
  return (
    <button
      type="button"
      onClick={() => {
        window.location.href = `${apiClient.defaults.baseURL}/auth/sso/start`;
      }}
      className="mt-3 w-full rounded-md border border-border py-2 text-sm hover:bg-muted"
    >
      Sign in with {data.displayName ?? "single sign-on"}
    </button>
  );
}

const REMEMBERED_EMAIL_KEY = "accuqual-remembered-email";

function TrustDeviceChoice({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label htmlFor="trust-device" className="mt-4 flex cursor-pointer items-start gap-3 rounded-md border border-border bg-background/50 p-3 text-sm text-foreground">
      <input
        id="trust-device"
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 h-4 w-4 shrink-0 accent-[hsl(var(--primary))]"
      />
      <span>
        <span className="font-medium">Trust this browser for 30 days</span>
        <span className="mt-1 block text-xs text-muted-foreground">Don't ask for a code on this device for 30 days. Your password is still required every time. After 30 days, or in a different browser, we'll ask for the code again.</span>
      </span>
    </label>
  );
}

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
  const [password, setPassword] = useState("");
  const [trustDevice, setTrustDevice] = useState(true);
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
        <TrustDeviceChoice checked={trustDevice} onChange={setTrustDevice} />
        <MfaEnrollPanel<AuthResponse>
          start={() => mfaApi.enrollStart(mfaToken)}
          confirm={async (c) => {
            const session = await mfaApi.enrollConfirm(mfaToken, c, false, trustDevice);
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
            startSession(await mfaApi.verify(mfaToken, code, false, trustDevice));
          } catch (err) {
            setCodeError(extractErrorMessage(err, "That code didn't work."));
          } finally {
            setCodeBusy(false);
          }
        }}
      >
        <TextField label="Authentication code" autoComplete="one-time-code" autoFocus value={code} onChange={(e) => setCode(e.target.value)} required />
        <p className="mt-1 text-xs text-muted-foreground">Lost your phone? Enter one of your recovery codes instead (like ABCDE-FGHIJ).</p>
        <TrustDeviceChoice checked={trustDevice} onChange={setTrustDevice} />
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
        storeRememberedEmail(email);
        login.mutate(
          { email, password },
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
      </div>

      {ssoError && <p className="mt-3 text-sm text-destructive">{SSO_ERRORS[ssoError] ?? "Single sign-on didn't complete. Please try again."}</p>}
      {login.isError && <p className="mt-3 text-sm text-destructive">{extractErrorMessage(login.error, "Invalid email or password.").replace(/^Invalid credentials$/, "Invalid email or password.")}</p>}

      <button type="submit" disabled={login.isPending} className="mt-6 w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {login.isPending ? "Signing in…" : "Sign in"}
      </button>

      <SsoSignIn />

    </Card>
  );
}
