import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, ShieldAlert } from "lucide-react";
import { apiClient } from "../../api/client";
import { TextField } from "../../components/forms/Field";
import { MfaEnrollPanel, RecoveryCodesPanel } from "../../components/auth/MfaPanels";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { formatDate } from "../../lib/dates";

export interface MfaStatus {
  enabled: boolean;
  required: boolean;
  state: "ok" | "grace" | "blocked";
  graceEndsAt: string | null;
  policy: string | null;
  recoveryCodesRemaining: number;
}

export function useMfaStatus() {
  return useQuery<MfaStatus>({ queryKey: ["auth/mfa/status"], queryFn: async () => (await apiClient.get("/auth/mfa/status")).data, staleTime: 60_000 });
}

type Mode = "idle" | "enrolling" | "codes" | "regenerate" | "disable";

/** Password + current code, the re-check demanded before turning MFA off or replacing recovery codes. */
function ReverifyForm({ submitLabel, onSubmit, onCancel }: { submitLabel: string; onSubmit: (password: string, code: string) => Promise<void>; onCancel: () => void }) {
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="mt-3 flex flex-col gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setError(null);
        setBusy(true);
        try {
          await onSubmit(password, code);
        } catch (err) {
          setError(extractErrorMessage(err, "Password or code was incorrect."));
        } finally {
          setBusy(false);
        }
      }}
    >
      <TextField label="Your password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      <TextField label="Authentication code (or a recovery code)" autoComplete="one-time-code" value={code} onChange={(e) => setCode(e.target.value)} required />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={busy} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy ? "Checking…" : submitLabel}
        </button>
        <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm">
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Settings → Security: turn the signed-in user's own second factor on or off and manage recovery codes. */
export function MfaSettingsSection() {
  const { data: status, isLoading } = useMfaStatus();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>("idle");
  const [codes, setCodes] = useState<string[]>([]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["auth/mfa/status"] });

  if (isLoading || !status) return <p className="text-sm text-muted-foreground">Loading…</p>;

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex items-center gap-2">
        {status.enabled ? <ShieldCheck size={18} className="text-green-600" /> : <ShieldAlert size={18} className="text-amber-600" />}
        <h3 className="text-sm font-medium">Two-step sign-in (authenticator app)</h3>
      </div>

      {mode === "idle" && (
        <>
          <p className="text-sm text-muted-foreground">
            {status.enabled
              ? `On. Signing in needs your password and a 6-digit code from your authenticator app. ${status.recoveryCodesRemaining} recovery code${status.recoveryCodesRemaining === 1 ? "" : "s"} left.`
              : "Off. Adding a code from your phone means a stolen or guessed password alone can't get into your account."}
          </p>
          {status.required && !status.enabled && (
            <p className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-sm">
              Your organization requires this
              {status.graceEndsAt ? ` — set it up by ${new Date(status.graceEndsAt).toLocaleDateString()} or you'll be asked to at your next sign-in after that.` : "."}
            </p>
          )}
          {status.enabled && status.required && <p className="mt-2 text-xs text-muted-foreground">Your organization requires this, so it can't be turned off.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {!status.enabled && (
              <button onClick={() => setMode("enrolling")} className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground">
                Set up
              </button>
            )}
            {status.enabled && (
              <button onClick={() => setMode("regenerate")} className="rounded-md border border-border px-4 py-2 text-sm">
                New recovery codes
              </button>
            )}
            {status.enabled && !status.required && (
              <button onClick={() => setMode("disable")} className="rounded-md border border-border px-4 py-2 text-sm text-destructive">
                Turn off
              </button>
            )}
          </div>
        </>
      )}

      {mode === "enrolling" && (
        <MfaEnrollPanel<null>
          start={async () => (await apiClient.post("/auth/mfa/setup")).data}
          confirm={async (code) => ({ recoveryCodes: (await apiClient.post("/auth/mfa/enable", { code })).data.recoveryCodes as string[], payload: null })}
          onEnrolled={(c) => {
            setCodes(c);
            setMode("codes");
            void refresh();
          }}
          onCancel={() => setMode("idle")}
        />
      )}

      {mode === "codes" && <RecoveryCodesPanel codes={codes} onContinue={() => setMode("idle")} continueLabel="Done" />}

      {mode === "regenerate" && (
        <>
          <p className="text-sm text-muted-foreground">This replaces your current recovery codes — the old ones stop working.</p>
          <ReverifyForm
            submitLabel="Generate new codes"
            onCancel={() => setMode("idle")}
            onSubmit={async (password, code) => {
              const res = await apiClient.post("/auth/mfa/recovery-codes", { password, code });
              setCodes(res.data.recoveryCodes);
              setMode("codes");
              void refresh();
            }}
          />
        </>
      )}

      {mode === "disable" && (
        <>
          <p className="text-sm text-muted-foreground">Turn off two-step sign-in for your account.</p>
          <ReverifyForm
            submitLabel="Turn off"
            onCancel={() => setMode("idle")}
            onSubmit={async (password, code) => {
              await apiClient.post("/auth/mfa/disable", { password, code });
              toast.success("Two-step sign-in turned off.");
              setMode("idle");
              void refresh();
              void queryClient.invalidateQueries({ queryKey: ["auth/trusted-devices"] });
            }}
          />
        </>
      )}
    </div>
  );
}

interface TrustedDevice {
  id: number;
  label: string;
  createdAt: string;
  expiresAt: string;
  lastUsedAt: string | null;
  current: boolean;
}

/** Settings → Security: browsers that can skip the authenticator code until they expire. */
export function TrustedDevicesSection() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { data, isLoading, isError } = useQuery<{ devices: TrustedDevice[] }>({
    queryKey: ["auth/trusted-devices"],
    queryFn: async () => (await apiClient.get("/auth/trusted-devices")).data,
  });

  async function forget(path: string, success: string) {
    try {
      await apiClient.delete(path);
      toast.success(success);
      await queryClient.invalidateQueries({ queryKey: ["auth/trusted-devices"] });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't forget that device."));
    }
  }

  async function forgetAll() {
    if (!window.confirm("Forget every trusted device? Each one will ask for an authenticator code the next time you sign in there.")) return;
    try {
      await apiClient.post("/auth/trusted-devices/forget-all");
      toast.success("All trusted devices forgotten.");
      await queryClient.invalidateQueries({ queryKey: ["auth/trusted-devices"] });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't forget those devices."));
    }
  }

  const devices = data?.devices ?? [];

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <h3 className="text-sm font-medium">Signed-in trusted devices</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        A trusted device skips the authenticator code for 30 days. Your password is still required every time. The 30 days start when you trust the device and do not restart when you sign in.
      </p>

      {isLoading && <p className="mt-3 text-sm text-muted-foreground">Loading…</p>}
      {isError && <p className="mt-3 text-sm text-destructive">Couldn't load trusted devices.</p>}

      {!isLoading && !isError && devices.length === 0 && (
        <p className="mt-3 text-sm text-muted-foreground">None yet. The next time you enter an authenticator code, leave the box checked to trust that browser for 30 days.</p>
      )}

      {devices.length > 0 && (
        <ul className="mt-3 divide-y divide-border">
          {devices.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <p className="text-sm font-medium">
                  {device.label}
                  {device.current && <span className="ml-2 text-xs font-normal text-muted-foreground">This device</span>}
                </p>
                <p className="text-xs text-muted-foreground">
                  Added {formatDate(device.createdAt)} · Expires {formatDate(device.expiresAt)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!window.confirm(device.current ? "Forget this device? This browser will ask for an authenticator code the next time you sign in." : "Forget this device? It will ask for an authenticator code the next time you sign in there.")) return;
                  void forget(`/auth/trusted-devices/${device.id}`, "Device forgotten.");
                }}
                className="rounded-md border border-border px-3 py-1.5 text-sm"
              >
                Forget this device
              </button>
            </li>
          ))}
        </ul>
      )}

      {devices.length > 0 && (
        <button type="button" onClick={() => void forgetAll()} className="mt-2 text-sm text-destructive hover:underline">
          Forget all devices
        </button>
      )}
    </div>
  );
}
