import { useEffect, useState } from "react";
import { Modal } from "../modals/Modal";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { DUPLICATE_RECORD_NUMBER } from "../../lib/recordNumberMessage";
import { showRecordNumber } from "../../lib/userRecordNumber";

/**
 * Editable record number. Blank by default, with no sample number in the box.
 * Saving is the caller's existing edit permission — this field does not add a role check.
 */
export function RecordNumberField({
  label,
  value,
  onChange,
  onBlur,
  error,
  disabled = false,
  name = "recordNumber",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  error?: string | null;
  disabled?: boolean;
  name?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      <input
        name={name}
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        className="w-full rounded-[9px] border border-form-field bg-[hsl(var(--form-input))] px-2.5 py-2 text-sm text-[hsl(var(--form-input-foreground))] outline-none focus:border-ring disabled:opacity-60"
      />
      {error && <span className="text-xs text-destructive">{error}</span>}
    </label>
  );
}

/** Detail-page editor. Blur saves through the record's existing update call. */
export function RecordNumberEditor({
  label,
  value,
  canEdit,
  onSave,
}: {
  label: string;
  value: string | null | undefined;
  canEdit: boolean;
  onSave: (next: string) => Promise<unknown>;
}) {
  const saved = showRecordNumber(value);
  const [draft, setDraft] = useState(saved);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(saved), [saved]);

  return (
    <RecordNumberField
      label={label}
      value={draft}
      disabled={!canEdit}
      error={error}
      onChange={(next) => {
        setDraft(next);
        if (error) setError(null);
      }}
      onBlur={() => {
        if (!canEdit || draft.trim() === saved) return;
        void onSave(draft)
          .then(() => setError(null))
          .catch((err) => setError(extractErrorMessage(err, "Couldn't save that number.")));
      }}
    />
  );
}

export function duplicateNumberError(message: string | null | undefined): string | null {
  if (!message) return null;
  return message.includes(DUPLICATE_RECORD_NUMBER) ? message : null;
}

/** Create dialog with an optional number. Blank is allowed. The caller saves through the existing create call. */
export function NumberedCreateButton({
  label,
  numberLabel,
  pending = false,
  onCreate,
  className = "rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60",
  dialogTitle = "New record",
}: {
  label: string;
  numberLabel: string;
  pending?: boolean;
  onCreate: (recordNumber: string) => Promise<unknown>;
  className?: string;
  dialogTitle?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  return (
    <>
      <button type="button" className={className} disabled={pending} onClick={() => { setValue(""); setError(null); setOpen(true); }}>
        {pending ? "Creating…" : label}
      </button>
      <Modal title={dialogTitle} isOpen={open} onClose={() => setOpen(false)}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            void onCreate(value)
              .then(() => setOpen(false))
              .catch((err) => setError(extractErrorMessage(err, "Couldn't create that record.")));
          }}
        >
          <RecordNumberField label={numberLabel} value={value} error={error} onChange={(next) => { setValue(next); if (error) setError(null); }} />
          <button type="submit" disabled={pending} className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
            {pending ? "Creating…" : "Create"}
          </button>
        </form>
      </Modal>
    </>
  );
}
