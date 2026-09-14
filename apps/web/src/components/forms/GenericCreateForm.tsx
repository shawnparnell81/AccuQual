import { useState } from "react";
import { TextField, SelectField } from "./Field";

export interface FieldSpec {
  name: string;
  label: string;
  type?: "text" | "number" | "select" | "date";
  options?: string[];
}

interface GenericCreateFormProps {
  fields: FieldSpec[];
  onSubmit: (values: Record<string, unknown>) => void;
  submitLabel?: string;
}

/**
 * Every field is kept as a plain string in local state (simplest for a
 * controlled input regardless of type) and converted at submit time
 * instead — a `type: "number"` field submits a real number, not the raw
 * string every backend Zod schema without `.coerce` used to reject with a
 * silent 400 (see the QA sweep review). A field left blank is omitted
 * entirely rather than coerced to 0, preserving "optional means optional"
 * for schemas like calibration's `calibrationIntervalDays`.
 */
function toSubmitValues(fields: FieldSpec[], values: Record<string, string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = values[field.name];
    if (raw === undefined || raw === "") continue;
    result[field.name] = field.type === "number" ? Number(raw) : raw;
  }
  return result;
}

/** Renders a small create form from a field spec — used by every simple master-data module page. */
export function GenericCreateForm({ fields, onSubmit, submitLabel = "Create" }: GenericCreateFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(toSubmitValues(fields, values));
        // Deliberately no setValues({}) here: this form only ever lives
        // inside a Modal that unmounts on close (see Modal.tsx's `if
        // (!isOpen) return null`), which already discards this state. The
        // previous unconditional reset here cleared every field immediately
        // on click regardless of whether the create actually succeeded —
        // on a validation error the modal stays open (see
        // ResourceListPage.tsx) but the user's typed values were already
        // gone, compounding the confusion of a silently-failed submit. See
        // the QA sweep review.
      }}
    >
      {fields.map((field) =>
        field.type === "select" ? (
          <SelectField
            key={field.name}
            label={field.label}
            value={values[field.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
          >
            <option value="">Select…</option>
            {field.options?.map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </SelectField>
        ) : (
          <TextField
            key={field.name}
            label={field.label}
            type={field.type ?? "text"}
            value={values[field.name] ?? ""}
            onChange={(e) => setValues((v) => ({ ...v, [field.name]: e.target.value }))}
          />
        )
      )}
      <button type="submit" className="rounded-md bg-primary py-2 text-sm font-medium text-primary-foreground">
        {submitLabel}
      </button>
    </form>
  );
}
