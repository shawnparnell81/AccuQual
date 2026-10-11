import { useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useQueryClient } from "@tanstack/react-query";
import { useCreateFormVersion, exportFormPdf, exportFormPdfResult, useFormTemplate } from "../../api/formHooks";
import { PdfExportActions } from "../records/PdfExportActions";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { FORM_FIELD_SPECS } from "./formFieldSpecs";
import { FormFieldOverlay } from "./FormFieldOverlay";
import { FormVersionHistory } from "./FormVersionHistory";
import { PdfViewer } from "./PdfViewer";
import { getFormLayout } from "./layouts";
import { GenericFormRenderer } from "./GenericFormRenderer";
import { getCustomFormComponent } from "./customForms";
import { fileChosenFolder, FormNumberEditor, RecordFolderField, SaveResult, useFormFiling, type SaveResultState } from "./FormDocumentControls";
import { useFormEditorState } from "./useFormEditorState";
import { ProcessFlowDiagramEditor } from "./processFlowDiagram/ProcessFlowDiagramEditor";
import { formAllowsInlinePictures } from "./inlinePictures";
import { PictureRecordProvider, pictureRecordForForm } from "./pictureRecord";
import { FormSignProvider } from "./formSign";
import { FormHeader } from "../brand/DmaLogo";
import { focusFirstEditable } from "../shared/GridClipboard";
import { RecordEditButton } from "../shared/RecordEditButton";
import { PrintRecordButton } from "../records/PrintRecordButton";
import { collectInspectionFailures } from "../../lib/inspectionFailures";

interface FormEditorProps {
  formType: string;
  entityId: number;
  windowId: string;
}

/** The actual data-entry surface for one form: fields, auto-save, versioning, export, preview. */
export function FormEditor({ formType, entityId, windowId }: FormEditorProps) {
  const layout = getFormLayout(formType);
  const navigate = useNavigate();
  const CustomComponent = getCustomFormComponent(formType);
  const fields = FORM_FIELD_SPECS[formType] ?? [];
  const queryClient = useQueryClient();
  const { formData, isLoading, values, updateField, saveNow, isSaving } = useFormEditorState(formType, entityId, windowId);
  const templateQuery = useFormTemplate(formType);
  const [saveNote, setSaveNote] = useState<SaveResultState>(null);
  const [pending, setPending] = useState(false);
  const gageFiling = useFormFiling(formType === "gage_rr" ? "frm-msa-001" : null, entityId);
  const gageNumber = gageFiling.data?.snapshotted ? gageFiling.data.formNumber : "";
  const createVersion = useCreateFormVersion(formType, entityId);
  const toast = useToast();

  const [showHistory, setShowHistory] = useState(false);
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const [previewBytes, setPreviewBytes] = useState<Uint8Array | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [exportId, setExportId] = useState<string | null>(null);

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
      const result = await exportFormPdfResult(formType, entityId);
      setExportId(result.exportId);
      const blob = new Blob([result.bytes as BlobPart], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const title = layout?.title?.replace(/[\\/:*?"<>|]+/g, "").trim();
      a.href = url;
      a.download = `${title || formType}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't export this form — save it at least once first."));
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading form…</p>;
  if (formType === "document_control_index") {
    return (
      <p className="text-sm">
        Document Control Master Index is retired. Use the{" "}
        <Link to="/documents/master-list" className="text-primary hover:underline">
          Master Document List
        </Link>
        .
      </p>
    );
  }

  const pictureRecord = pictureRecordForForm(formType, entityId);
  const allowPictures = formAllowsInlinePictures(formType);
  const managed = formType === "management_review" || formType === "context_of_organization" || formType === "management_review_minutes" || formType === "staff_meeting_minutes";
  const editor = (
    <div ref={editorRef} className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <RecordEditButton
          editing={editing}
          onClick={() => {
            const next = !editing;
            setEditing(next);
            if (next) focusFirstEditable(editorRef.current);
          }}
        />
        <span>{`Rev ${formData?.templateRevision ?? templateQuery.data?.templateRevision ?? "A"}`}</span>
        <span className="ml-auto">{isSaving || pending ? "Saving…" : saveNote == null ? "Auto-saved" : ""}</span>
        {(formType === "final_inspection_release_checklist" || formType === "dimensional_report") && collectInspectionFailures(values).length > 0 && !Array.isArray(values.linkedNcrs) && (
          <button
            type="button"
            className="rounded-md border border-border px-2 py-1 text-sm text-foreground"
            data-testid="create-ncr"
            onClick={() => {
              const rows = collectInspectionFailures(values);
              const part = [values.customerPartNo, values.internalPartNo, values.partNumber, values.partDescription].find((value) => typeof value === "string" && value.trim());
              void apiClient.post<{ id: number }>("/ncr/from-inspection", {
                sourceKind: "form",
                formType,
                sourceId: entityId,
                formTitle: layout?.title || "Inspection",
                path: pictureRecord.entityType === "ppap" ? `/ppap/${entityId}` : `/${pictureRecord.entityType}/${entityId}`,
                part: typeof part === "string" ? part : "",
                rows,
              }).then((response) => {
                toast.success("NCR created. Type the NCR number on that record.");
                navigate(`/ncr/${response.data.id}`);
              }).catch((err) => toast.error(extractErrorMessage(err, "Couldn't create the NCR.")));
            }}
          >
            Create NCR
          </button>
        )}
        <SaveResult result={saveNote} />
        {formType === "gage_rr" && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setPending(true);
              setSaveNote(null);
              void saveNow()
                .then(() => fileChosenFolder(queryClient, "frm-msa-001", entityId))
                .then((filed) => setSaveNote(filed ?? "unfiled"))
                .catch(() => setSaveNote("error"))
                .finally(() => setPending(false));
            }}
            className="rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-60"
          >
            {pending ? "Saving…" : "Save"}
          </button>
        )}
      </div>
      {formType === "gage_rr" && (
        <div className="flex flex-col gap-2">
          <FormNumberEditor formKey="frm-msa-001" />
          <RecordFolderField formKey="frm-msa-001" recordId={entityId} prepare={() => saveNow()} />
        </div>
      )}

      {formType === "process_flow_diagram" && <ProcessFlowDiagramEditor data={values} onChange={updateField} />}

      {layout ? (
        <GenericFormRenderer layout={layout} data={values} onChange={updateField} readOnly={managed && !editing} />
      ) : CustomComponent ? (
        <>
          <FormHeader />
          <CustomComponent data={values} onChange={updateField} documentNumber={formType === "gage_rr" ? gageNumber : undefined} />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <FormHeader />
          {fields.map((field) => (
            <FormFieldOverlay key={field.name} field={field} value={values[field.name]} onChange={(v) => updateField(field.name, v)} />
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-border pt-3">
        <button
          type="button"
          disabled={createVersion.isPending}
          onClick={() => {
            if (createVersion.isPending) return;
            createVersion.mutate(undefined, {
              onSuccess: (version) => {
                if (formType === "calibration") {
                  if (version?.calibrationEventLogged === false) {
                    toast.error("Version saved, but the calibration event wasn't logged — add the performed date first.");
                  } else {
                    toast.success("Calibration event logged.");
                  }
                  void queryClient.invalidateQueries({ queryKey: ["equipment"] });
                } else if (formType === "training") {
                  toast.success("Training completed.");
                } else {
                  toast.success("Version saved.");
                }
              },
              onError: (err) => toast.error(extractErrorMessage(err, "Couldn't save this version.")),
            });
          }}
          className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted disabled:opacity-60"
        >
          {createVersion.isPending
            ? "Saving…"
            : formType === "calibration"
              ? "Log Calibration Event"
              : formType === "training"
                ? "Complete Training"
                : "Save version"}
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
        <PrintRecordButton />
      </div>
      <PdfExportActions exportId={exportId} entityType={formType} entityId={entityId} />

      {showHistory && <FormVersionHistory formType={formType} entityId={entityId} />}
      {(previewBytes || previewLoading) && <PdfViewer data={previewBytes} isLoading={previewLoading} />}
    </div>
  );

  return (
    <FormSignProvider formType={formType} entityId={entityId}>
      {allowPictures ? (
        <PictureRecordProvider entityType={pictureRecord.entityType} entityId={pictureRecord.entityId}>
          {editor}
        </PictureRecordProvider>
      ) : (
        editor
      )}
    </FormSignProvider>
  );
}
