import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { RMA_LOG_FORM_SCHEMA } from "./rmaLogFormSchema";
import type { RmaLogRecord } from "../../api/types";

function toDateInputValue(v: unknown): string {
  if (!v || typeof v !== "string") return "";
  return v.slice(0, 10);
}

/** Reads RMA_LOG_FORM_SCHEMA to lay out and render the whole form — see that file's own comment. `disabledFields` is how the linkage-only carve-out (rma_log.linkage.write vs. the base rma_log.write) shows up in the UI: the 3 link fields live outside this renderer entirely (see RmaLogDetailPage's own Linked Records panel), so nothing here needs to know about them. */
export function RmaLogFormRenderer({
  value,
  onChange,
  readOnly,
}: {
  value: Partial<RmaLogRecord>;
  onChange: (patch: Partial<RmaLogRecord>) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
      {RMA_LOG_FORM_SCHEMA.map((row, i) => (
        <div key={i} className="grid grid-cols-12 gap-3">
          {row.map((f) => {
            const raw = value[f.name];
            if (f.type === "textarea") {
              return (
                <div key={f.name} className="col-span-12">
                  <TextAreaField label={f.label} value={(raw as string) ?? ""} disabled={readOnly} onChange={(e) => onChange({ [f.name]: e.target.value } as Partial<RmaLogRecord>)} rows={4} />
                </div>
              );
            }
            if (f.type === "select") {
              return (
                <div key={f.name} style={{ gridColumn: `span ${f.span} / span ${f.span}` }}>
                  <SelectField label={f.label} value={(raw as string) ?? ""} disabled={readOnly} onChange={(e) => onChange({ [f.name]: e.target.value || null } as Partial<RmaLogRecord>)}>
                    <option value="">Select…</option>
                    {f.options?.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </SelectField>
                </div>
              );
            }
            return (
              <div key={f.name} style={{ gridColumn: `span ${f.span} / span ${f.span}` }}>
                <TextField
                  label={f.label}
                  type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                  value={f.type === "date" ? toDateInputValue(raw) : (raw as string | number) ?? ""}
                  // rmaNumber is always disabled here — auto-generated from
                  // the record's own id at creation (see
                  // rmaLog.controller.ts's generateRmaLogNumber), same
                  // "never hand-editable after the fact" rule the RMA/RGA
                  // and Supplier RMA Request modules already follow for
                  // their own auto-numbering.
                  disabled={readOnly || f.name === "rmaNumber"}
                  onChange={(e) => onChange({ [f.name]: e.target.value || null } as Partial<RmaLogRecord>)}
                />
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
