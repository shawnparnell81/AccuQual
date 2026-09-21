import { TextAreaField, TextField } from "../forms/Field";
import type { DocumentPayload } from "../../api/documents";

interface Props {
  /** The revision being shown (a draft while it is editable, otherwise the released or historical one). */
  values: DocumentPayload;
  editable: boolean;
  onChange: (patch: Partial<DocumentPayload>) => void;
  /** The change summary written when the draft was started (shown in the version history). */
  summary?: string;
  onSummaryChange?: (summary: string) => void;
}

const dateInput = (iso: string | null) => (iso ? iso.slice(0, 10) : "");
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : "—");

/** A revision's title, revision code, dates, retention and body. Read-only text unless it is an editable draft. */
export function DocumentDetailsPanel({ values, editable, onChange, summary, onSummaryChange }: Props) {
  if (!editable) {
    return (
      <div className="flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Field label="Title" value={values.title} />
          <Field label="Category" value={values.category ?? "—"} />
          <Field label="Revision" value={values.revisionCode} />
          <Field label="Effective date" value={fmt(values.effectiveDate)} />
          <Field label="Expiration date" value={fmt(values.expirationDate)} />
          <Field label="Retention after obsolete" value={values.retentionPeriodDays ? `${values.retentionPeriodDays} days` : "—"} />
        </dl>
        <div>
          <h3 className="mb-1 text-sm font-medium">Content</h3>
          {values.content.trim() ? (
            <div className="whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-relaxed">{values.content}</div>
          ) : (
            <p className="text-sm text-muted-foreground">No written content — this revision is carried by its attached files.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-3 md:grid-cols-2">
        <TextField label="Title" value={values.title} maxLength={300} onChange={(e) => onChange({ title: e.target.value })} />
        <TextField label="Category" value={values.category ?? ""} maxLength={100} onChange={(e) => onChange({ category: e.target.value || null })} />
        <TextField label="Revision code" value={values.revisionCode} maxLength={20} placeholder="Rev A" onChange={(e) => onChange({ revisionCode: e.target.value })} />
        <TextField label="Effective date" type="date" value={dateInput(values.effectiveDate)} onChange={(e) => onChange({ effectiveDate: e.target.value || null })} />
        <TextField label="Expiration date (optional)" type="date" value={dateInput(values.expirationDate)} onChange={(e) => onChange({ expirationDate: e.target.value || null })} />
        <TextField
          label="Retention after obsolete, in days (optional)"
          type="number"
          min={1}
          value={values.retentionPeriodDays ?? ""}
          onChange={(e) => onChange({ retentionPeriodDays: e.target.value ? Number(e.target.value) : null })}
        />
      </div>
      {onSummaryChange && <TextField label="What changed in this revision" value={summary ?? ""} maxLength={500} placeholder="Shown in the version history" onChange={(e) => onSummaryChange(e.target.value)} />}
      <TextAreaField label="Content" rows={16} value={values.content} onChange={(e) => onChange({ content: e.target.value })} placeholder="Write the document here, or attach a file on the Files tab (or both)." />
      <p className="-mt-2 text-xs text-muted-foreground">{values.content.length.toLocaleString()} / 200,000 characters</p>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}
