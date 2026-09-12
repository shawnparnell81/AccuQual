import { useEffect, useRef, useState } from "react";
import { useFormData, useSaveForm, useCreateFormVersion, exportFormPdf } from "../../api/formHooks";
import { useFormStore } from "../../store/formStore";
import { FORM_FIELD_SPECS } from "./formFieldSpecs";
import { FormFieldOverlay } from "./FormFieldOverlay";
import { FormVersionHistory } from "./FormVersionHistory";
import { PdfViewer } from "./PdfViewer";
import { getFormLayout } from "./layouts";
import { GenericFormRenderer } from "./GenericFormRenderer";
import { getCustomFormComponent } from "./customForms";

interface FormEditorProps {
  formType: string;
  entityId: number;
  windowId: string;
}

const AUTOSAVE_DELAY_MS = 1200;

/** The actual data-entry surface for one form: fields, auto-save, versioning, export, preview. */
export function FormEditor({ formType, entityId, windowId }: FormEditorProps) {
  const layout = getFormLayout(formType);
  const CustomComponent = getCustomFormComponent(formType);
  const fields = FORM_FIELD_SPECS[formType] ?? [];
  const { data: formData, isLoading } = useFormData(formType, entityId);
  const saveForm = useSaveForm(formType, entityId);
  const createVersion = useCreateFormVersion(formType, entityId);
  const { setDirty, setSaving } = useFormStore();

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [showHistory, setShowHistory] = useState(false);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const autosaveTimer = useRef<ReturnType<typeof setTimeout>>();
  const hydrated = useRef(false);

  // Hydrate local field state once the current form_data row loads.
  useEffect(() => {
    if (!hydrated.current && formData) {
      setValues(formData.data ?? {});
      hydrated.current = true;
    }
  }, [formData]);

  function updateField(name: string, value: unknown) {
    const next = { ...values, [name]: value };
    setValues(next);
    setDirty(windowId, true);

    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setSaving(windowId, true);
      saveForm.mutate(next, {
        onSettled: () => {
          setSaving(windowId, false);
          setDirty(windowId, false);
        },
      });
    }, AUTOSAVE_DELAY_MS);
  }

  async function handlePreview() {
    setPreviewLoading(true);
    try {
      setPreviewBytes(await exportFormPdf(formType, entityId));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDownload() {
    const bytes = await exportFormPdf(formType, entityId);
    const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${formType}-${entityId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading form…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formData ? `Version ${formData.version}` : "New form"}</span>
        <span>{saveForm.isPending ? "Saving…" : "Auto-saved"}</span>
      </div>

      {layout ? (
        <GenericFormRenderer layout={layout} data={values} onChange={updateField} />
      ) : CustomComponent ? (
        <CustomComponent data={values} onChange={updateField} />
      ) : (
        <div className="flex flex-col gap-3">
          {fields.map((field) => (
            <FormFieldOverlay key={field.name} field={field} value={values[field.name]} onChange={(v) => updateField(field.name, v)} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <button onClick={() => createVersion.mutate()} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
          {formType === "calibration" ? "Log Calibration Event" : "Save version"}
        </button>
        <button onClick={() => setShowHistory((s) => !s)} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
          {showHistory ? "Hide" : "Show"} version history
        </button>
        <button onClick={handlePreview} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted">
          Preview PDF
        </button>
        <button onClick={handleDownload} className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground">
          Export PDF
        </button>
      </div>

      {showHistory && <FormVersionHistory formType={formType} entityId={entityId} />}
      {(previewBytes || previewLoading) && <PdfViewer data={previewBytes} isLoading={previewLoading} />}
    </div>
  );
}
