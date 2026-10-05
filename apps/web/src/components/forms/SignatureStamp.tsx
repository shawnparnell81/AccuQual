import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { NOT_REQUIRED_LABEL, type SignatureChoice } from "./signatureRequired";

/** Sibling date field the server fills the first time a signature is stamped. */
export const SIGNATURE_DATE_FIELD: Record<string, string> = {
  signature: "date",
  authorizedSignature: "date",
  approvalSignature: "approvalDate",
  signatureTitle: "signatureDate",
};

export const DEFAULT_CERTIFY = "I certify that this record is accurate and that I approve this sign-off.";

/**
 * Shared signature control. The PIN is a masked 4-digit entry and is cleared
 * after every attempt. A successful stamp replaces this control with the
 * server's name and timestamp. The PIN is never shown again.
 */
function RequiredChoice({
  value,
  disabled,
  onChange,
}: {
  value: SignatureChoice;
  disabled?: boolean;
  onChange: (next: SignatureChoice) => void;
}) {
  function choose(next: SignatureChoice) {
    if (disabled || next === value) return;
    onChange(next);
  }

  function onKeyDown(event: KeyboardEvent<HTMLSpanElement>, option: SignatureChoice) {
    if (disabled) return;
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      choose(option);
      return;
    }
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const next = option === "yes" ? "no" : "yes";
    choose(next);
    const group = event.currentTarget.parentElement;
    group?.querySelector<HTMLElement>(`[data-choice="${next}"]`)?.focus();
  }

  return (
    <div role="radiogroup" aria-label="Required" className="aq-required-choice">
      <span className="aq-required-label">Required</span>
      {(["yes", "no"] as const).map((option) => {
        const selected = value === option;
        const label = option === "yes" ? "Yes" : "No";
        return (
          <span
            key={option}
            role="radio"
            data-choice={option}
            aria-checked={selected}
            aria-disabled={disabled || undefined}
            tabIndex={disabled ? -1 : 0}
            onClick={() => choose(option)}
            onKeyDown={(event) => onKeyDown(event, option)}
          >
            <span className="aq-required-mark" aria-hidden="true" />
            {label}
          </span>
        );
      })}
    </div>
  );
}

export function SignatureStamp({
  value,
  certify,
  disabled,
  onSign,
  variant = "app",
  requirement,
}: {
  value?: string | null;
  certify: string;
  disabled?: boolean;
  onSign: (pin: string) => Promise<unknown>;
  variant?: "app" | "sheet";
  /** Present only when this form has more than one signature block. */
  requirement?: {
    value: SignatureChoice;
    disabled?: boolean;
    onChange: (next: SignatureChoice) => void;
  };
}) {
  const [pin, setPin] = useState("");
  const [certified, setCertified] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stamped = (value ?? "").trim();
  const sheet = variant === "sheet";
  // The record often keeps the previous choice until a save returns. Hold the
  // click here so Yes/No, and the PIN block, move immediately.
  const savedChoice = requirement?.value ?? "yes";
  const [choiceDraft, setChoiceDraft] = useState<SignatureChoice | null>(null);
  useEffect(() => {
    setChoiceDraft(null);
  }, [savedChoice]);
  const choiceValue = choiceDraft ?? savedChoice;
  const waived = requirement != null && choiceValue === "no";
  const choice = requirement ? (
    <RequiredChoice
      value={choiceValue}
      disabled={requirement.disabled}
      onChange={(next) => {
        setChoiceDraft(next);
        requirement.onChange(next);
      }}
    />
  ) : null;

  if (stamped) {
    return (
      <div className={sheet ? "px-2 py-1.5" : undefined}>
        {choice}
        <p className={sheet ? "whitespace-pre-wrap text-xs text-foreground" : "whitespace-pre-wrap text-xs text-foreground"}>{stamped}</p>
      </div>
    );
  }
  if (waived) {
    return (
      <div className={sheet ? "px-2 py-1.5" : undefined}>
        {choice}
        <p className="text-xs text-muted-foreground">{NOT_REQUIRED_LABEL}</p>
      </div>
    );
  }
  if (disabled) {
    return (
      <div className={sheet ? "px-2 py-1.5" : undefined}>
        {choice}
        <p className="text-xs text-muted-foreground">—</p>
      </div>
    );
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!certified) {
      setError("Check the certification box before signing.");
      return;
    }
    if (!/^\d{4}$/.test(pin)) {
      setError("Enter a 4-digit PIN.");
      return;
    }
    setBusy(true);
    const attempt = pin;
    setPin("");
    try {
      await onSign(attempt);
      setCertified(false);
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't record that signature."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(event) => void submit(event)} className={sheet ? "flex flex-col gap-1.5 px-2 py-1.5" : "flex flex-col gap-1.5 py-1"}>
      {choice}
      <label className="flex items-start gap-2 text-[11px] leading-snug text-foreground">
        <input type="checkbox" checked={certified} onChange={(event) => setCertified(event.target.checked)} className="mt-0.5" />
        <span>{certify}</span>
      </label>
      <div className="flex flex-wrap items-center gap-1.5">
        <input
          type="password"
          inputMode="numeric"
          autoComplete="off"
          name="signature-pin"
          maxLength={4}
          aria-label="4-digit signature PIN"
          value={pin}
          onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
          className={
            sheet
              ? "w-16 rounded border border-border bg-background px-1.5 py-0.5 text-xs tracking-widest text-foreground outline-none"
              : "w-20 rounded border border-border bg-background px-2 py-1 text-xs tracking-widest outline-none focus:ring-1 focus:ring-primary"
          }
          placeholder="PIN"
        />
        <button
          type="submit"
          disabled={busy}
          className={
            sheet
              ? "rounded bg-primary px-2 py-0.5 text-xs font-medium text-primary-foreground disabled:opacity-60"
              : "rounded bg-primary px-2 py-1 text-xs font-medium text-primary-foreground disabled:opacity-60"
          }
        >
          {busy ? "Signing…" : "Sign"}
        </button>
      </div>
      {error && <p className="text-[11px] text-destructive">{error}</p>}
    </form>
  );
}
