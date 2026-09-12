import type { FormField } from "../../types/forms";
import { TextField, TextAreaField } from "./Field";

interface FormFieldOverlayProps {
  field: FormField;
  value: unknown;
  onChange: (value: string) => void;
}

/**
 * Renders one bound form field. Named "overlay" per the Forms & PDF Engine
 * Spec's `FormFieldOverlay.tsx`, but — since AccuQual doesn't have real
 * per-tenant AcroForm coordinate maps to overlay onto a PDF canvas yet (see
 * pdf-merger.ts's plain-render fallback) — this renders as a normal bound
 * input in the field list rather than a positioned overlay on top of
 * PdfViewer. Swapping in true coordinate overlays later only touches this
 * component.
 */
export function FormFieldOverlay({ field, value, onChange }: FormFieldOverlayProps) {
  const stringValue = value == null ? "" : String(value);

  if (field.type === "textarea") {
    return <TextAreaField label={field.label} value={stringValue} onChange={(e) => onChange(e.target.value)} />;
  }

  return (
    <TextField
      label={field.label}
      type={field.type === "date" ? "date" : "text"}
      value={stringValue}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
