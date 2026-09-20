import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Copy, Download } from "lucide-react";
import { TextField } from "../forms/Field";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";

/** Groups a base32 secret in fours so it is easy to type by hand: "ABCD EFGH …". */
function groupSecret(secret: string) {
  return secret.replace(/(.{4})/g, "$1 ").trim();
}

interface EnrollPanelProps<T> {
  /** Asks the server for a fresh secret. */
  start: () => Promise<{ secret: string; otpauthUri: string }>;
  /** Proves the first code; resolves with recovery codes (and whatever else the caller needs, e.g. a finished session). */
  confirm: (code: string) => Promise<{ recoveryCodes: string[]; payload: T }>;
  onEnrolled: (recoveryCodes: string[], payload: T) => void;
  onCancel?: () => void;
}

/** Scan-a-QR, type-a-code enrollment, shared by the forced sign-in flow and Settings → Security. */
export function MfaEnrollPanel<T>({ start, confirm, onEnrolled, onCancel }: EnrollPanelProps<T>) {
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    start()
      .then(async (s) => {
        const qr = await QRCode.toDataURL(s.otpauthUri, { margin: 1, width: 180 });
        if (!cancelled) setSetup({ secret: s.secret, qr });
      })
      .catch((err) => !cancelled && setError(extractErrorMessage(err, "Couldn't start setup. Please try again.")));
    return () => {
      cancelled = true;
    };
    // Once per mount: re-running would replace the secret the user is midway through scanning.
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const result = await confirm(code);
      onEnrolled(result.recoveryCodes, result.payload);
    } catch (err) {
      setError(extractErrorMessage(err, "That code didn't match. Try the newest code."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Open an authenticator app (Microsoft Authenticator, Google Authenticator, 1Password, Authy…).</li>
        <li>Scan this code, or type the key by hand.</li>
        <li>Enter the 6-digit code the app shows.</li>
      </ol>
      {setup ? (
        <div className="flex flex-col items-center gap-2">
          <img src={setup.qr} alt="QR code to add AccuQual to your authenticator app" className="h-[180px] w-[180px] rounded-md border border-border bg-white p-1" />
          <p className="select-all break-all text-center font-mono text-xs tracking-wider text-muted-foreground">{groupSecret(setup.secret)}</p>
        </div>
      ) : (
        !error && <p className="text-center text-sm text-muted-foreground">Preparing your setup…</p>
      )}
      <TextField
        label="6-digit code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]{6,7}"
        maxLength={7}
        value={code}
        onChange={(e) => setCode(e.target.value)}
        required
        disabled={!setup}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2">
        <button type="submit" disabled={!setup || busy} className="flex-1 rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
          {busy ? "Checking…" : "Turn on"}
        </button>
        {onCancel && (
          <button type="button" onClick={onCancel} className="rounded-md border border-border px-4 py-2 text-sm">
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

/** Shows the one-time recovery codes; the user must confirm they saved them before continuing. */
export function RecoveryCodesPanel({ codes, onContinue, continueLabel = "Continue" }: { codes: string[]; onContinue: () => void; continueLabel?: string }) {
  const [saved, setSaved] = useState(false);
  const text = codes.join("\n");

  function download() {
    const blob = new Blob([`AccuQual recovery codes\nEach code works once. Keep them somewhere safe.\n\n${text}\n`], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "accuqual-recovery-codes.txt";
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        If you lose your phone, each of these codes signs you in once. They are shown <strong>only now</strong> — save them somewhere safe, such as a password manager.
      </p>
      <ul className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-md border border-border bg-muted/40 p-3 font-mono text-sm">
        {codes.map((c) => (
          <li key={c} className="select-all">
            {c}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <button type="button" onClick={() => void navigator.clipboard?.writeText(text)} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs">
          <Copy size={14} /> Copy
        </button>
        <button type="button" onClick={download} className="flex items-center gap-1 rounded-md border border-border px-3 py-1.5 text-xs">
          <Download size={14} /> Download
        </button>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I have saved these codes
      </label>
      <button type="button" disabled={!saved} onClick={onContinue} className="w-full rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {continueLabel}
      </button>
    </div>
  );
}
