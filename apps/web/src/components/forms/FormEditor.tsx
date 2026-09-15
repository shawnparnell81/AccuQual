import { useState } from "react";
import { useCreateFormVersion, exportFormPdf } from "../../api/formHooks";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { FORM_FIELD_SPECS } from "./formFieldSpecs";
import { FormFieldOverlay } from "./FormFieldOverlay";
import { FormVersionHistory } from "./FormVersionHistory";
import { PdfViewer } from "./PdfViewer";
import { getFormLayout } from "./layouts";
import { GenericFormRenderer } from "./GenericFormRenderer";
import { getCustomFormComponent } from "./customForms";
import { useFormEditorState } from "./useFormEditorState";

interface FormEditorProps {
  formType: string;
  entityId: number;
  windowId: string;
}

/** The actual data-entry surface for one form: fields, auto-save, versioning, export, preview. */
export function FormEditor({ formType, entityId, windowId }: FormEditorProps) {
  const layout = getFormLayout(formType);
  const CustomComponent = getCustomFormComponent(formType);
  const fields = FORM_FIELD_SPECS[formType] ?? [];
  const { formData, isLoading, values, updateField, isSaving } = useFormEditorState(formType, entityId, windowId);
  const createVersion = useCreateFormVersion(formType, entityId);
  const toast = useToast();

  const [showHistory, setShowHistory] = useState(false);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Both used to have no (or no complete) catch — exportFormPdf 404s until
  // the form has been saved at least once (nothing to export yet), and
  // that rejection used to propagate as an uncaught exception with zero
  // feedback: the button just looked broken. See the QA sweep review.
  async function handlePreview() {
    setPreviewLoading(true);
    try {
      setPreviewBytes(await exportFormPdf(formType, entityId));
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't load a preview — save the form at least once first."));
    } finally {
      setPreviewLoading(false);
    }
  }

  async function handleDownload() {
    try {
      const bytes = await exportFormPdf(formType, entityId);
      const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${formType}-${entityId}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't export this form — save it at least once first."));
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading form…</p>;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{formData ? `Version ${formData.version}` : "New form"}</span>
        <span>{isSaving ? "Saving…" : "Auto-saved"}</span>
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
          {formType === "calibration" ? "Log Calibration Event" : formType === "training" ? "Complete Training" : "Save version"}
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
