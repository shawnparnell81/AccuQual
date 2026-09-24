import { useEffect, useState } from "react";
import { Modal } from "../modals/Modal";
import { TextAreaField } from "../forms/Field";

/** What a board move needs before it happens: a short written entry, or just a confirmation. */
export interface StepRequest {
  title: string;
  description: string;
  /** Present when the step needs a written entry. */
  fieldLabel?: string;
  minLength?: number;
  submitLabel: string;
  run: (text: string) => Promise<unknown>;
}

export function StepMoveModal({ step, onClose }: { step: StepRequest | null; onClose: () => void }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (step) setText("");
  }, [step]);

  if (!step) return null;
  const tooShort = !!step.fieldLabel && text.trim().length < (step.minLength ?? 1);

  return (
    <Modal title={step.title} isOpen onClose={onClose}>
      <form
        className="flex flex-col gap-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (tooShort) return;
          setBusy(true);
          try {
            await step.run(text.trim());
            onClose();
          } catch {
            // The caller has already shown the reason; stay open so nothing typed is lost.
          } finally {
            setBusy(false);
          }
        }}
      >
        <p className="text-sm text-muted-foreground">{step.description}</p>
        {step.fieldLabel && (
          <TextAreaField label={step.fieldLabel} value={text} onChange={(e) => setText(e.target.value)} rows={4} required autoFocus />
        )}
        {step.fieldLabel && step.minLength && step.minLength > 1 && <p className="-mt-2 text-xs text-muted-foreground">At least {step.minLength} characters.</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-md border border-border px-3 py-2 text-sm hover:bg-muted">
            Cancel
          </button>
          <button type="submit" disabled={busy || tooShort} className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {busy ? "Saving…" : step.submitLabel}
          </button>
        </div>
      </form>
    </Modal>
  );
}
