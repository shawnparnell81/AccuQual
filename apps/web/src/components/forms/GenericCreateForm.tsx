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

/** Renders a small create form from a field spec — used by every simple master-data module page. */
export function GenericCreateForm({ fields, onSubmit, submitLabel = "Create" }: GenericCreateFormProps) {
  const [values, setValues] = useState<Record<string, string>>({});

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(values);
        setValues({});
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
