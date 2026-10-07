import { useId, useMemo, useState } from "react";
import { addRecipient, recipientLabel } from "../../lib/reportRecipients";

export interface RecipientPerson {
  id: number;
  name: string;
  email: string;
}

/**
 * Chip list for report email. Pick a company user by name, or type any address.
 * Invalid text stays in the box. A duplicate is refused. × removes a chip.
 */
export function ReportRecipientsField({
  label = "Email recipients",
  value,
  onChange,
  people,
  disabled = false,
  hideLabel = false,
  testId = "report-recipients",
}: {
  label?: string;
  value: string[];
  onChange: (next: string[]) => void;
  people: RecipientPerson[];
  disabled?: boolean;
  hideLabel?: boolean;
  testId?: string;
}) {
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const inputId = useId();
  const listId = useId();

  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    if (!query) return [];
    const taken = new Set(value.map((email) => email.toLowerCase()));
    return people
      .filter((person) => !taken.has(person.email.trim().toLowerCase()))
      .filter((person) => person.name.toLowerCase().includes(query) || person.email.toLowerCase().includes(query))
      .slice(0, 8);
  }, [draft, people, value]);

  function commit(raw: string) {
    const parts = raw.split(/[,;\n]+/).map((part) => part.trim()).filter(Boolean);
    if (parts.length === 0) {
      setDraft("");
      return;
    }
    let next = value;
    for (const part of parts) {
      const result = addRecipient(next, part);
      if (!result.ok) {
        setError(result.error);
        setDraft(part);
        setOpen(true);
        return;
      }
      next = result.emails;
    }
    onChange(next);
    setDraft("");
    setError("");
    setOpen(false);
  }

  function remove(email: string) {
    onChange(value.filter((item) => item !== email));
  }

  return (
    <div className="flex min-w-[16rem] flex-1 flex-col gap-1 text-sm" data-testid={testId}>
      <label htmlFor={inputId} className={hideLabel ? "sr-only" : "text-xs font-semibold text-muted-foreground"}>
        {label}
      </label>
      <div
        role="group"
        aria-label={label}
        className="flex flex-wrap items-center gap-1.5 rounded-[9px] border border-form-field bg-[hsl(var(--form-input))] px-2 py-1.5"
      >
        {value.map((email) => {
          const text = recipientLabel(email, people);
          return (
            <span key={email} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs text-foreground" title={email}>
              <span className="truncate">{text}</span>
              {disabled ? null : (
                <button type="button" className="leading-none text-muted-foreground hover:text-foreground" aria-label={`Remove ${text}`} onClick={() => remove(email)}>
                  ×
                </button>
              )}
            </span>
          );
        })}
        {disabled ? null : (
          <input
            id={inputId}
            value={draft}
            placeholder={value.length === 0 ? "Name or email" : ""}
            className="min-w-[8rem] flex-1 bg-transparent px-1 py-1 text-sm text-[hsl(var(--form-input-foreground))] outline-none"
            aria-invalid={error ? true : undefined}
            aria-autocomplete="list"
            aria-controls={listId}
            aria-expanded={open && suggestions.length > 0}
            autoComplete="off"
            onChange={(event) => {
              const next = event.target.value;
              if (/[,;\n]/.test(next)) {
                commit(next);
                return;
              }
              setDraft(next);
              setError("");
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={(event) => {
              setOpen(false);
              if (event.currentTarget.value.trim()) commit(event.currentTarget.value);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === ",") {
                event.preventDefault();
                commit(draft);
              } else if (event.key === "Backspace" && draft === "" && value.length > 0) {
                const last = value[value.length - 1];
                if (last) remove(last);
              } else if (event.key === "Escape") {
                setOpen(false);
              }
            }}
          />
        )}
      </div>
      {open && suggestions.length > 0 && !disabled ? (
        <ul id={listId} role="listbox" className="z-20 max-h-48 overflow-auto rounded-md border border-border bg-card shadow-sm">
          {suggestions.map((person) => (
            <li key={person.id} role="option">
              <button
                type="button"
                className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-muted"
                onMouseDown={(event) => {
                  event.preventDefault();
                  commit(person.email);
                }}
              >
                <span className="text-sm">{person.name}</span>
                <span className="text-xs text-muted-foreground">{person.email}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {disabled ? (
        value.length === 0 ? <p className="text-xs text-muted-foreground">No recipients yet.</p> : null
      ) : error ? (
        <p className="text-xs text-destructive">{error}</p>
      ) : (
        <p className="text-xs text-muted-foreground">Pick a person or type an email. Press Enter to add another.</p>
      )}
    </div>
  );
}
