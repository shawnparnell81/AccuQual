import { TextField, TextAreaField, SelectField } from "../../components/forms/Field";
import { CRAR_FORM_SCHEMA, type CrarRow } from "./crarFormSchema";
import type { CrarClaim } from "../../api/types";

function toDateInputValue(v: unknown): string {
  if (!v || typeof v !== "string") return "";
  return v.slice(0, 10);
}

/**
 * Reads CRAR_FORM_SCHEMA to lay out and render the whole form — the
 * "JSON-schema dynamic form engine" applied to the CRAR specifically (see
 * crarFormSchema.ts's own comment on why this app's generic form_data
 * engine isn't the right fit here: a CRAR needs real relational FKs and a
 * real department-gated workflow, not a flat jsonb blob). Nothing about a
 * field's label, type, or grouping is hardcoded here — only this
 * component's generic row/column rendering is.
 */
export function CrarFormRenderer({
  value,
  onChange,
  readOnly,
  disabledFields,
}: {
  value: Partial<CrarClaim>;
  onChange: (patch: Partial<CrarClaim>) => void;
  readOnly?: boolean;
  disabledFields?: Set<string>;
}) {
  function renderRow(row: CrarRow, key: number) {
    if (Array.isArray(row)) {
      return (
        <div key={key} className="grid grid-cols-12 gap-3">
          {row.map((f) => {
            const disabled = readOnly || disabledFields?.has(f.name);
            const raw = value[f.name];
            if (f.type === "textarea") {
              return (
                <div key={f.name} className={`col-span-12`}>
                  <TextAreaField label={f.label} value={(raw as string) ?? ""} disabled={disabled} onChange={(e) => onChange({ [f.name]: e.target.value } as Partial<CrarClaim>)} rows={4} />
                </div>
              );
            }
            if (f.type === "select") {
              return (
                <div key={f.name} style={{ gridColumn: `span ${f.span} / span ${f.span}` }}>
                  <SelectField label={f.label} value={(raw as string) ?? ""} disabled={disabled} onChange={(e) => onChange({ [f.name]: e.target.value } as Partial<CrarClaim>)}>
                    <option value="">Select…</option>
                    {f.options?.map((opt) => (
                      <option key={opt} value={opt}>
                        {opt}
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
                  type={f.type === "date" ? "date" : "text"}
                  value={f.type === "date" ? toDateInputValue(raw) : (raw as string) ?? ""}
                  disabled={disabled}
                  onChange={(e) => onChange({ [f.name]: e.target.value || null } as Partial<CrarClaim>)}
                />
              </div>
            );
          })}
        </div>
      );
    }
    return (
      <div key={key} className="flex flex-wrap gap-6">
        {row.items.map((item) => (
          <label key={item.name} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={Boolean(value[item.name])}
              disabled={readOnly || disabledFields?.has(item.name)}
              onChange={(e) => onChange({ [item.name]: e.target.checked } as Partial<CrarClaim>)}
              className="h-4 w-4 rounded border-form-field"
            />
            {item.label}
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {CRAR_FORM_SCHEMA.map((section) => (
        <div key={section.number} className="flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
          <h3 className="text-sm font-medium text-primary">
            {section.number}. {section.title}
          </h3>
          {section.rows.map((row, i) => renderRow(row, i))}
        </div>
      ))}
    </div>
  );
}
