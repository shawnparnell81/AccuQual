import { useState } from "react";
import { SignatureStamp, DEFAULT_CERTIFY } from "../../components/forms/SignatureStamp";
import type { FieldFormStructure, FieldType, FormField } from "../../lib/formGrid";
import "./formBuilder.css";

const TYPES: { type: FieldType; label: string }[] = [
  { type: "text", label: "Text" },
  { type: "multiline", label: "Multi-line" },
  { type: "number", label: "Number" },
  { type: "date", label: "Date" },
  { type: "dropdown", label: "Dropdown" },
  { type: "checkbox", label: "Checkbox" },
  { type: "yesno", label: "Yes/No" },
  { type: "table", label: "Table" },
  { type: "signature", label: "Signature" },
  { type: "photo", label: "Photo" },
];

function newId(): string {
  return `f-${Math.random().toString(36).slice(2, 8)}`;
}

export function FieldsFormEditor({
  structure,
  onChange,
  mode,
  answers,
  onAnswer,
  onSign,
}: {
  structure: FieldFormStructure;
  onChange?: (next: FieldFormStructure) => void;
  mode: "design" | "fill";
  answers?: Record<string, unknown>;
  onAnswer?: (key: string, value: unknown) => void;
  onSign?: (fieldId: string, pin: string) => Promise<unknown>;
}) {
  const [dragId, setDragId] = useState<string | null>(null);

  function addField(type: FieldType, sectionId: string) {
    const field: FormField = {
      id: newId(),
      sectionId,
      type,
      label: TYPES.find((item) => item.type === type)?.label ?? "Field",
      required: false,
      options: type === "dropdown" ? ["Yes", "No"] : undefined,
      columns: type === "table" ? [{ id: "c1", label: "Column 1" }, { id: "c2", label: "Column 2" }] : undefined,
    };
    onChange?.({ ...structure, fields: [...structure.fields, field] });
  }

  function patch(id: string, next: Partial<FormField>) {
    onChange?.({ ...structure, fields: structure.fields.map((field) => (field.id === id ? { ...field, ...next } : field)) });
  }

  function move(id: string, beforeId: string) {
    const fields = [...structure.fields];
    const from = fields.findIndex((field) => field.id === id);
    const to = fields.findIndex((field) => field.id === beforeId);
    if (from < 0 || to < 0 || from === to) return;
    const [item] = fields.splice(from, 1);
    fields.splice(to, 0, item!);
    onChange?.({ ...structure, fields });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="fields-editor">
      {mode === "design" && (
        <div className="no-print flex flex-wrap gap-1">
          {TYPES.map((item) => (
            <button key={item.type} type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => addField(item.type, structure.sections[0]?.id ?? "general")}>
              {item.label}
            </button>
          ))}
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-sm"
            onClick={() => onChange?.({ ...structure, sections: [...structure.sections, { id: newId(), title: "Section" }] })}
          >
            Add section
          </button>
        </div>
      )}
      {structure.sections.map((section) => (
        <section key={section.id} className="flex flex-col gap-2">
          {mode === "design" ? (
            <input className="bg-transparent text-base font-semibold" aria-label="Section title" value={section.title} onChange={(event) => onChange?.({ ...structure, sections: structure.sections.map((item) => (item.id === section.id ? { ...item, title: event.target.value } : item)) })} />
          ) : (
            <h2 className="text-base font-semibold">{section.title}</h2>
          )}
          {structure.fields
            .filter((field) => field.sectionId === section.id)
            .map((field) => (
              <div
                key={field.id}
                className="fb-field"
                draggable={mode === "design"}
                onDragStart={() => setDragId(field.id)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragId) move(dragId, field.id);
                  setDragId(null);
                }}
              >
                {mode === "design" ? (
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
                    <input aria-label="Field label" className="min-w-0 flex-1 border-b border-black/20 bg-transparent font-medium" value={field.label} onChange={(event) => patch(field.id, { label: event.target.value })} />
                    <label className="flex items-center gap-1">
                      <input type="checkbox" checked={field.required} onChange={(event) => patch(field.id, { required: event.target.checked })} />
                      Required
                    </label>
                    <select aria-label="Section" value={field.sectionId} onChange={(event) => patch(field.id, { sectionId: event.target.value })}>
                      {structure.sections.map((item) => (
                        <option key={item.id} value={item.id}>{item.title}</option>
                      ))}
                    </select>
                    <button type="button" className="text-muted-foreground" onClick={() => onChange?.({ ...structure, fields: structure.fields.filter((item) => item.id !== field.id) })}>Remove</button>
                  </div>
                ) : (
                  <div className="mb-1 text-sm font-medium">
                    {field.label}
                    {field.required ? " *" : ""}
                  </div>
                )}
                <FieldControl field={field} mode={mode} value={answers?.[field.id]} onChange={(value) => onAnswer?.(field.id, value)} onSign={onSign} onOptions={(options) => patch(field.id, { options })} />
              </div>
            ))}
        </section>
      ))}
    </div>
  );
}

function FieldControl({
  field,
  mode,
  value,
  onChange,
  onSign,
  onOptions,
}: {
  field: FormField;
  mode: "design" | "fill";
  value: unknown;
  onChange: (value: unknown) => void;
  onSign?: (fieldId: string, pin: string) => Promise<unknown>;
  onOptions: (options: string[]) => void;
}) {
  if (mode === "design" && field.type === "dropdown") {
    return <input aria-label="Dropdown choices" value={(field.options ?? []).join(", ")} onChange={(event) => onOptions(event.target.value.split(",").map((item) => item.trim()).filter(Boolean))} />;
  }
  if (field.type === "multiline") return <textarea rows={3} disabled={mode === "design"} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)} />;
  if (field.type === "checkbox") return <input type="checkbox" disabled={mode === "design"} checked={value === true} onChange={(event) => onChange(event.target.checked)} />;
  if (field.type === "yesno") {
    return (
      <select disabled={mode === "design"} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose</option>
        <option value="Yes">Yes</option>
        <option value="No">No</option>
      </select>
    );
  }
  if (field.type === "dropdown") {
    return (
      <select disabled={mode === "design"} value={typeof value === "string" ? value : ""} onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose</option>
        {(field.options ?? []).map((option) => (
          <option key={option} value={option}>{option}</option>
        ))}
      </select>
    );
  }
  if (field.type === "table") {
    const rows = Array.isArray(value) ? (value as Record<string, string>[]) : [{}];
    return (
      <div>
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {(field.columns ?? []).map((column) => (
                <th key={column.id} className="border border-black/20 px-1 text-left">{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>
                {(field.columns ?? []).map((column) => (
                  <td key={column.id} className="border border-black/20">
                    <input disabled={mode === "design"} value={row[column.id] ?? ""} onChange={(event) => {
                      const next = rows.map((item, rowIndex) => (rowIndex === index ? { ...item, [column.id]: event.target.value } : item));
                      onChange(next);
                    }} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {mode === "fill" && (
          <button type="button" className="mt-1 text-sm text-[#0A3C7B]" onClick={() => onChange([...rows, {}])}>Add row</button>
        )}
      </div>
    );
  }
  if (field.type === "signature") {
    const stamped = value && typeof value === "object" && "text" in value ? String((value as { text?: string }).text ?? "") : "";
    if (mode === "design") return <p className="fb-note">Signature uses the 4-digit PIN and the certification stamp when the form is filled.</p>;
    return <SignatureStamp value={stamped} certify={DEFAULT_CERTIFY} onSign={(pin) => onSign?.(field.id, pin) ?? Promise.resolve()} />;
  }
  if (field.type === "photo") {
    if (mode === "design") return <p className="fb-note">A photo can be attached when the form is filled.</p>;
    return (
      <div>
        <input
          type="file"
          accept="image/*"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            if (file.size > 1_000_000) {
              window.alert("Use a photo under 1 MB.");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => onChange(String(reader.result));
            reader.readAsDataURL(file);
          }}
        />
        {typeof value === "string" && value.startsWith("data:") ? <img src={value} alt="" className="mt-2 max-h-40" /> : null}
      </div>
    );
  }
  return <input type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"} disabled={mode === "design"} value={typeof value === "string" || typeof value === "number" ? String(value) : ""} onChange={(event) => onChange(event.target.value)} />;
}
