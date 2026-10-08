import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { RecordNumberEditor, RecordNumberField } from "../../components/forms/RecordNumberField";
import { recordHeading } from "../../lib/userRecordNumber";
import { SaveAsFolderDialog } from "../../components/forms/SaveAsFolderDialog";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import type { BrowseFolder } from "../../lib/folderBrowse";
import { bandHasContent } from "../../lib/documentBands";
import { blankDocument, blankFields, blankGrid, type BuiltStructure, type DocumentFormStructure, type FieldFormStructure, type GridFormStructure } from "../../lib/formGrid";
import { DocumentFormEditor } from "./DocumentFormEditor";
import { FieldsFormEditor } from "./FieldsFormEditor";
import { FormMasthead, Paper } from "./FormChrome";
import { GridFormEditor } from "./GridFormEditor";

interface FillRecord {
  id: number;
  formId: number;
  recordNumber?: string | null;
  templateRevision: string;
  templateFormNumber: string | null;
  title: string;
  structure: BuiltStructure;
  answers: Record<string, unknown>;
  folderId: number | null;
}

export function FormFillPage() {
  const { fillId } = useParams();
  const id = Number(fillId);
  const toast = useToast();
  const queryClient = useQueryClient();
  const fill = useQuery({
    queryKey: ["form-builder-fill", id],
    queryFn: async () => (await apiClient.get<FillRecord>(`/form-builder/fills/${id}`)).data,
    enabled: Number.isInteger(id),
  });
  const folders = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<BrowseFolder[]>("/document-folders")).data,
  });
  const [answers, setAnswers] = useState<Record<string, unknown>>({});
  const [saveAs, setSaveAs] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!fill.data || ready) return;
    setAnswers(fill.data.answers ?? {});
    setReady(true);
  }, [fill.data, ready]);

  const save = useMutation({
    mutationFn: async () => (await apiClient.patch(`/form-builder/fills/${id}`, { answers })).data,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["form-builder-fill", id] });
    },
  });

  useEffect(() => {
    if (!ready) return;
    const timer = window.setTimeout(() => save.mutate(), 800);
    return () => window.clearTimeout(timer);
  }, [answers, ready]);

  const file = useMutation({
    mutationFn: async (folderId: number) => (await apiClient.post<{ folder: string }>(`/form-builder/fills/${id}/file`, { folderId })).data,
    onSuccess: (result) => {
      toast.success(`Saved in ${result.folder}. The blank template was not changed.`);
      setSaveAs(false);
      void queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't file that copy.")),
  });

  if (!fill.data) return <p className="text-sm text-muted-foreground">{fill.isError ? extractErrorMessage(fill.error, "That copy is not available.") : "Opening a fresh copy…"}</p>;
  const structure = fill.data.structure;
  const grid: GridFormStructure = structure.kind === "grid" ? structure : blankGrid();
  const document: DocumentFormStructure = structure.kind === "document" ? structure : blankDocument();
  const fields: FieldFormStructure = structure.kind === "fields" ? structure : blankFields();
  const textAnswers = Object.fromEntries(Object.entries(answers).filter((entry): entry is [string, string] => typeof entry[1] === "string"));

  return (
    <div className="flex flex-col gap-3">
      <div className="no-print flex flex-wrap items-end justify-between gap-2">
        <div className="flex flex-col gap-2">
          <p className="text-sm text-muted-foreground">This is a new copy of revision {fill.data.templateRevision}. The blank template is not changed.</p>
          <RecordNumberEditor
            label="Record No."
            value={fill.data.recordNumber}
            canEdit
            onSave={async (next) => {
              await apiClient.patch(`/form-builder/fills/${id}`, { recordNumber: next.trim() || null });
              await queryClient.invalidateQueries({ queryKey: ["form-builder-fill", id] });
            }}
          />
        </div>
        <button type="button" className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground" onClick={() => setSaveAs(true)}>Save as</button>
      </div>
      <Paper
        wide={structure.kind === "grid"}
        docId={structure.kind === "document" ? fill.data.templateFormNumber : undefined}
        rev={structure.kind === "document" ? fill.data.templateRevision : undefined}
      >
        {structure.kind === "document" && bandHasContent(document.header) ? null : (
          <FormMasthead formNumber={fill.data.templateFormNumber} revision={fill.data.templateRevision} title={fill.data.title} />
        )}
        {structure.kind === "grid" && (
          <GridFormEditor
            structure={grid}
            mode="fill"
            answers={textAnswers}
            onAnswer={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
          />
        )}
        {structure.kind === "document" && (
          <DocumentFormEditor
            structure={document}
            mode="fill"
            answers={textAnswers}
            onAnswer={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
          />
        )}
        {structure.kind === "fields" && (
          <FieldsFormEditor
            structure={fields}
            mode="fill"
            answers={answers}
            onAnswer={(key, value) => setAnswers((current) => ({ ...current, [key]: value }))}
            onSign={async (fieldId, pin) => {
              const saved = await apiClient.post<FillRecord>(`/form-builder/fills/${id}/sign`, { fieldId, pin });
              setAnswers(saved.data.answers ?? {});
            }}
          />
        )}
      </Paper>
      <p className="no-print text-xs text-muted-foreground">
        <Link to="/documents/folders" className="text-primary hover:underline">Folder Explorer</Link> keeps the blank. Save as picks the folder for this copy.
      </p>
      {saveAs && (
        <SaveAsFolderDialog
          folders={folders.data ?? []}
          selectedId=""
          pending={file.isPending}
          onClose={() => setSaveAs(false)}
          onSave={(folderId) => file.mutate(folderId)}
        />
      )}
    </div>
  );
}

export function FormTemplateOpenPage() {
  const { id } = useParams();
  const formId = Number(id);
  const navigate = useNavigate();
  const [recordNumber, setRecordNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function openCopy() {
    setPending(true);
    setError(null);
    try {
      const res = await apiClient.post<{ id: number }>(`/form-builder/${formId}/fills`, { recordNumber: recordNumber.trim() || null });
      navigate(`/form-builder/fills/${res.data.id}`, { replace: true });
    } catch (err) {
      setError(extractErrorMessage(err, "Couldn't open a copy of that form."));
      setPending(false);
    }
  }

  return (
    <form
      className="flex max-w-md flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void openCopy();
      }}
    >
      <h1 className="text-2xl font-semibold">{recordHeading("Filled form", recordNumber)}</h1>
      <p className="text-sm text-muted-foreground">Type the record number for this copy, or leave it blank. The blank template is not changed.</p>
      <RecordNumberField label="Record No." value={recordNumber} error={error} onChange={(value) => { setError(null); setRecordNumber(value); }} />
      <button type="submit" disabled={pending || !Number.isInteger(formId)} className="w-fit rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-60">
        {pending ? "Opening…" : "Open a copy"}
      </button>
    </form>
  );
}
