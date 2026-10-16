import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../../api/client";
import { useItemFolderPath } from "../../components/documents/ItemFolderPath";
import { useToast } from "../../components/shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { formatDateTime } from "../../lib/dates";
import { formStatusLabel, MAX_REVISION, newRevisionProblem } from "../../lib/formRevision";
import { BLANK_FORMS_TEMPLATES_FOLDER, type BrowseFolder } from "../../lib/folderBrowse";
import { bandHasContent, type DocumentBand } from "../../lib/documentBands";
import { blankDocument, blankFields, blankGrid, downloadGridWorkbook, importGridWorkbook, type BuiltStructure, type ImportNote, type DocumentFormStructure, type FieldFormStructure, type GridFormStructure } from "../../lib/formGrid";
import { DocumentFormEditor } from "./DocumentFormEditor";
import { FieldsFormEditor } from "./FieldsFormEditor";
import { FormMasthead, Paper } from "./FormChrome";
import { ApprovalSignatureFields, approvalReady } from "../../components/forms/FormRevisionHistory";
import { GridFormEditor } from "./GridFormEditor";

interface BuiltForm {
  id: number;
  kind: "grid" | "document" | "fields";
  title: string;
  formNumber: string | null;
  revision: string;
  status: string;
  structure: BuiltStructure;
  publishedStructure: BuiltStructure | null;
  folderId: number | null;
  /** The REV waiting for approval, if one is. */
  pendingRevision: string | null;
  pendingRevisionId: number | null;
  /** The person has the approve permission. */
  canApprove: boolean;
}

interface RevisionRow {
  id: number;
  revision: string;
  summary: string;
  description: string;
  savedByName: string | null;
  createdAt: string;
  status: "pending" | "approved" | "rejected";
  approvedByName: string | null;
  approvedAt: string | null;
  decisionNote: string | null;
  approvalSignature: string | null;
}

interface SaveInput {
  mode: "autosave" | "save";
  newRevision?: string;
  changeDescription?: string;
}

function RevisionFields({
  current,
  newRevision,
  description,
  onNewRevision,
  onDescription,
}: {
  current: string;
  newRevision: string;
  description: string;
  onNewRevision: (value: string) => void;
  onDescription: (value: string) => void;
}) {
  const problem = newRevisionProblem(current, newRevision);
  return (
    <div className="mt-3 flex flex-col gap-2 text-sm">
      <p>Current revision: <strong>REV {current}</strong></p>
      <label>
        New revision
        <input className="mt-1 w-full rounded border border-border bg-background px-2 py-1" value={newRevision} maxLength={MAX_REVISION} onChange={(event) => onNewRevision(event.target.value)} />
      </label>
      {problem ? <p role="alert" className="text-xs text-destructive">{problem}</p> : null}
      <label>
        Description of change
        <textarea className="mt-1 h-20 w-full rounded border border-border bg-background px-2 py-1" value={description} onChange={(event) => onDescription(event.target.value)} />
      </label>
      {description.trim() === "" ? <p role="alert" className="text-xs text-destructive">Describe what changed in this revision.</p> : null}
    </div>
  );
}

function asGrid(structure: BuiltStructure | undefined): GridFormStructure {
  return structure?.kind === "grid" ? structure : blankGrid();
}
function asDocument(structure: BuiltStructure | undefined): DocumentFormStructure {
  return structure?.kind === "document" ? structure : blankDocument();
}
function asFields(structure: BuiltStructure | undefined): FieldFormStructure {
  return structure?.kind === "fields" ? structure : blankFields();
}

export function FormBuilderEditorPage() {
  const { id } = useParams();
  const formId = Number(id);
  const navigate = useNavigate();
  const toast = useToast();
  const folderPath = useItemFolderPath();
  const queryClient = useQueryClient();
  const form = useQuery({
    queryKey: ["form-builder", formId],
    queryFn: async () => (await apiClient.get<BuiltForm>(`/form-builder/${formId}`)).data,
    enabled: Number.isInteger(formId),
  });
  const revisions = useQuery({
    queryKey: ["form-builder", formId, "revisions"],
    queryFn: async () => (await apiClient.get<RevisionRow[]>(`/form-builder/${formId}/revisions`)).data,
    enabled: Number.isInteger(formId),
  });
  const folders = useQuery({
    queryKey: ["document-folders"],
    queryFn: async () => (await apiClient.get<BrowseFolder[]>("/document-folders")).data,
  });
  const [title, setTitle] = useState("");
  const [formNumber, setFormNumber] = useState("");
  const [structure, setStructure] = useState<BuiltStructure | null>(null);
  const [preview, setPreview] = useState(false);
  const [previewAnswers, setPreviewAnswers] = useState<Record<string, unknown>>({});
  const [publishOpen, setPublishOpen] = useState(false);
  const [revisionOpen, setRevisionOpen] = useState(false);
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const [approvalPin, setApprovalPin] = useState("");
  const [approvalCertified, setApprovalCertified] = useState(false);
  const [approvedNotice, setApprovedNotice] = useState("");
  const [revisionText, setRevisionText] = useState("");
  const [newRevision, setNewRevision] = useState("");
  const [changeDescription, setChangeDescription] = useState("");
  const [savedNote, setSavedNote] = useState("Draft");
  const past = useRef<BuiltStructure[]>([]);
  const future = useRef<BuiltStructure[]>([]);
  const loaded = useRef(false);
  const skipSave = useRef(true);

  useEffect(() => {
    if (!form.data || loaded.current) return;
    loaded.current = true;
    setTitle(form.data.title);
    setFormNumber(form.data.formNumber ?? "");
    setRevisionText(form.data.revision);
    setStructure(form.data.structure);
  }, [form.data]);

  function editStructure(next: BuiltStructure) {
    setStructure((current) => {
      if (current) {
        past.current.push(current);
        if (past.current.length > 50) past.current.shift();
        future.current = [];
      }
      return next;
    });
  }

  const save = useMutation({
    mutationFn: async (input: SaveInput) =>
      (
        await apiClient.patch<BuiltForm>(`/form-builder/${formId}`, {
          title,
          formNumber,
          structure,
          mode: input.mode,
          // A draft's REV is whatever is typed in the REV box. A published form only changes it with a described change.
          ...(draft && revisionText.trim() ? { newRevision: revisionText.trim().slice(0, MAX_REVISION) } : {}),
          ...(input.newRevision ? { newRevision: input.newRevision, changeDescription: input.changeDescription } : {}),
        })
      ).data,
    onSuccess: (row, input) => {
      setSavedNote(row.status === "published" ? `Saved · Rev ${row.revision}` : "Draft saved");
      if (input.newRevision) {
        setRevisionOpen(false);
        setNewRevision("");
        setChangeDescription("");
        toast.success(`Saved as REV ${row.revision}.`);
      }
      void queryClient.invalidateQueries({ queryKey: ["form-builder", formId] });
      void queryClient.invalidateQueries({ queryKey: ["form-builder", formId, "revisions"] });
    },
    onError: (err, input) => {
      const message = extractErrorMessage(err, "Could not save that form.");
      if (input.mode === "autosave") setSavedNote(`Not saved: ${message}`);
      else toast.error(message);
    },
  });

  useEffect(() => {
    if (!structure || !loaded.current) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      setSavedNote("Saving…");
      save.mutate({ mode: "autosave" });
    }, 1200);
    return () => window.clearTimeout(timer);
  }, [structure, title, formNumber, revisionText]);

  const decide = useMutation({
    mutationFn: async (input: { kind: "approve" | "reject"; revId: number; note: string }) =>
      (
        await apiClient.post<{ notice?: string }>(
          `/form-builder/${formId}/revisions/${input.revId}/${input.kind}`,
          input.kind === "approve" ? { note: input.note, pin: approvalPin, certified: approvalCertified } : { note: input.note },
        )
      ).data,
    onSuccess: (data, input) => {
      setDecision(null);
      setDecisionNote("");
      setApprovalPin("");
      setApprovalCertified(false);
      if (input.kind === "approve") {
        setApprovedNotice(data.notice ?? "Update the Master Document List with the new revision.");
        toast.success("Revision approved. It is now live.");
      } else {
        toast.success("Revision rejected. The live version is unchanged.");
      }
      void queryClient.invalidateQueries({ queryKey: ["form-builder"] });
      void queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    },
    onError: (err) => {
      setApprovalPin("");
      toast.error(extractErrorMessage(err, "Could not record that decision."));
    },
  });

  const publish = useMutation({
    mutationFn: async (folderId: number) =>
      (
        await apiClient.post(`/form-builder/${formId}/publish`, {
          folderId,
          structure,
          ...(revisionNeeded ? { newRevision: newRevision.trim(), changeDescription: changeDescription.trim() } : {}),
        })
      ).data,
    onSuccess: () => {
      toast.success(revisionNeeded || draft ? "Submitted for approval." : "Published into Blank Forms Templates.");
      setPublishOpen(false);
      setNewRevision("");
      setChangeDescription("");
      void queryClient.invalidateQueries({ queryKey: ["form-builder"] });
      void queryClient.invalidateQueries({ queryKey: ["document-folders"] });
    },
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't publish that form.")),
  });

  const remove = useMutation({
    mutationFn: async () => apiClient.delete(`/form-builder/${formId}`),
    onSuccess: () => navigate("/form-builder"),
    onError: (err) => toast.error(extractErrorMessage(err, "Couldn't delete that form.")),
  });

  const draft = form.data?.status !== "published";
  // A published form's structure changed since it was published: saving or publishing it needs a new REV and a description.
  const pending = form.data?.pendingRevision ?? null;
  const revisionNeeded = Boolean(!pending && form.data && form.data.status === "published" && structure && JSON.stringify(structure) !== JSON.stringify(form.data.publishedStructure));
  const badge = form.data ? formStatusLabel({ status: form.data.status, revision: form.data.revision, pendingRevision: pending }) : "Draft";
  const revisionReady = form.data ? newRevisionProblem(form.data.revision, newRevision) === null && changeDescription.trim() !== "" : false;

  const [importNotes, setImportNotes] = useState<{ file: string; notes: ImportNote[] } | null>(null);

  if (form.isError) return <p className="text-sm text-destructive">{extractErrorMessage(form.error, "That form is not available.")}</p>;
  if (!form.data || !structure) return <p className="text-sm text-muted-foreground">Loading the form…</p>;

  const blankFolders = (folders.data ?? []).filter((folder) => {
    const names = new Set<string>();
    let current: BrowseFolder | undefined = folder;
    const seen = new Set<number>();
    while (current && !seen.has(current.id)) {
      seen.add(current.id);
      names.add(current.name);
      current = (folders.data ?? []).find((item) => item.id === current?.parentId);
    }
    return names.has(BLANK_FORMS_TEMPLATES_FOLDER);
  });

  async function onImport(file: File) {
    try {
      const imported = await importGridWorkbook(file);
      editStructure(imported.structure);
      setImportNotes({ file: file.name, notes: imported.notes });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't read that spreadsheet."));
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="no-print flex flex-wrap items-center justify-between gap-2">
        <div>
          <Link to="/form-builder" className="text-sm text-primary hover:underline">Form Builder</Link>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className={`rounded-full border px-2 py-0.5 font-medium ${pending ? "border-amber-500 text-amber-700 dark:text-amber-400" : form.data.status === "published" ? "border-emerald-600 text-emerald-700 dark:text-emerald-400" : "border-border"}`} data-testid="form-status">{badge}</span>
            <span>{savedNote}. Publishing sends the blank for approval. Filling a copy does not change this revision.</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => {
            const previous = past.current.pop();
            if (!previous) return;
            future.current.push(structure);
            setStructure(previous);
          }}>Undo</button>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => {
            const next = future.current.pop();
            if (!next) return;
            past.current.push(structure);
            setStructure(next);
          }}>Redo</button>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => setPreview((value) => !value)}>{preview ? "Edit" : "Preview"}</button>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => (revisionNeeded ? setRevisionOpen(true) : save.mutate({ mode: pending && !draft ? "autosave" : "save" }))}>Save</button>
          <button type="button" className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50" disabled={Boolean(pending)} title={pending ? `REV ${pending} is waiting for approval.` : undefined} onClick={() => setPublishOpen(true)}>{draft ? "Publish" : "Publish change"}</button>
          {pending && form.data.canApprove && form.data.pendingRevisionId != null ? (
            <>
              <button type="button" className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground" onClick={() => setDecision("approve")}>Approve REV {pending}</button>
              <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => setDecision("reject")}>Reject</button>
            </>
          ) : null}
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => remove.mutate()}>Delete</button>
        </div>
      </div>
      {approvedNotice ? (
        <p role="status" className="no-print flex items-center justify-between gap-2 rounded border border-emerald-600 bg-card px-3 py-2 text-sm">
          <span>{approvedNotice}</span>
          <button type="button" className="text-primary" onClick={() => setApprovedNotice("")}>Dismiss</button>
        </p>
      ) : null}
      {pending && !form.data.canApprove ? (
        <p className="no-print rounded border border-amber-500 bg-card px-3 py-2 text-sm">REV {pending} is waiting for approval. Fillers still open the last approved version{draft ? ", and there is none yet" : ""}.</p>
      ) : null}
      <div className="no-print grid gap-2 md:grid-cols-3">
        <label className="text-sm">
          Title
          <input className="mt-1 w-full rounded border border-border bg-background px-2 py-1" value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>
        <label className="text-sm">
          Form number
          <input className="mt-1 w-full rounded border border-border bg-background px-2 py-1" placeholder="Blank until you set it" value={formNumber} onChange={(event) => setFormNumber(event.target.value)} />
        </label>
        <label className="text-sm">
          REV
          {draft ? (
            <>
              <input className="mt-1 w-full rounded border border-border bg-background px-2 py-1" aria-label="Revision" maxLength={MAX_REVISION} value={revisionText} onChange={(event) => setRevisionText(event.target.value)} />
              {revisionText.trim() === "" ? <span role="alert" className="text-xs text-destructive">Enter a revision, such as A.</span> : <span className="text-xs text-muted-foreground">You set this until the first publish.</span>}
            </>
          ) : (
            <span className="mt-1 block rounded border border-border bg-muted px-2 py-1">REV {form.data.revision}</span>
          )}
        </label>
      </div>
      {form.data.kind === "grid" && !preview && (
        <div className="no-print flex gap-2">
          <label className="rounded border border-border px-2 py-1 text-sm">
            Import .xlsx
            <input type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void onImport(file);
            }} />
          </label>
          <button type="button" className="rounded border border-border px-2 py-1 text-sm" onClick={() => void downloadGridWorkbook(asGrid(structure), `${title || "form"}.xlsx`, folderPath)}>Download .xlsx</button>
        </div>
      )}
      {form.data.kind === "grid" && !preview && importNotes && (
        <section className="no-print rounded border border-border bg-card p-2 text-sm" aria-label="Import notes" data-testid="import-notes">
          <div className="flex items-center justify-between gap-2">
            <strong>
              {importNotes.notes.length === 0
                ? `Imported ${importNotes.file}. Everything came across.`
                : `Imported ${importNotes.file}. ${importNotes.notes.length} item${importNotes.notes.length === 1 ? "" : "s"} did not come across and need to be rebuilt by hand:`}
            </strong>
            <button type="button" className="text-xs text-primary hover:underline" onClick={() => setImportNotes(null)}>Dismiss</button>
          </div>
          {importNotes.notes.length > 0 && (
            <ul className="mt-1 list-disc pl-5">
              {importNotes.notes.map((note, index) => (
                <li key={index}>
                  {note.sheet}{note.cell ? ` ${note.cell}` : ""}: {note.formula ? <code className="rounded bg-muted px-1">{note.formula}</code> : null} {note.reason}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Nothing is saved until you save the layout. Undo puts the previous layout back.</p>
        </section>
      )}
      {form.data.kind === "document" && !preview && (
        <div className="no-print flex gap-2">
          <label className="rounded border border-border px-2 py-1 text-sm">
            Import .docx
            <input
              type="file"
              accept=".docx"
              className="sr-only"
              onChange={async (event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const body = new FormData();
                body.append("file", file);
                try {
                  const res = await apiClient.post<{ html: string; header: DocumentBand | null; footer: DocumentBand | null }>("/form-builder/import-docx", body);
                  editStructure({ ...asDocument(structure), html: res.data.html, header: res.data.header, footer: res.data.footer });
                } catch (err) {
                  toast.error(extractErrorMessage(err, "Couldn't read that Word file."));
                }
              }}
            />
          </label>
          <button
            type="button"
            className="rounded border border-border px-2 py-1 text-sm"
            onClick={async () => {
              try {
                const res = await apiClient.get(`/form-builder/${formId}/docx`, { responseType: "blob" });
                const url = URL.createObjectURL(res.data as Blob);
                const link = document.createElement("a");
                link.href = url;
                link.download = `${title || "document"}.docx`;
                link.click();
                URL.revokeObjectURL(url);
              } catch (err) {
                toast.error(extractErrorMessage(err, "Couldn't download that document."));
              }
            }}
          >
            Download .docx
          </button>
        </div>
      )}
      <Paper
        wide={form.data.kind === "grid"}
        docId={structure.kind === "document" ? formNumber : undefined}
        rev={structure.kind === "document" ? form.data.revision : undefined}
      >
        {structure.kind === "document" && bandHasContent(asDocument(structure).header) ? null : (
          <FormMasthead formNumber={formNumber} revision={form.data.revision} title={title} />
        )}
        {form.data.kind === "grid" && (
          <GridFormEditor
            structure={asGrid(structure)}
            mode={preview ? "fill" : "design"}
            onChange={editStructure}
            answers={Object.fromEntries(Object.entries(previewAnswers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))}
            onAnswer={(key, value) => setPreviewAnswers((current) => ({ ...current, [key]: value }))}
          />
        )}
        {form.data.kind === "document" && (
          <DocumentFormEditor
            structure={asDocument(structure)}
            mode={preview ? "fill" : "design"}
            onChange={editStructure}
            answers={Object.fromEntries(Object.entries(previewAnswers).filter((entry): entry is [string, string] => typeof entry[1] === "string"))}
            onAnswer={(key, value) => setPreviewAnswers((current) => ({ ...current, [key]: value }))}
          />
        )}
        {form.data.kind === "fields" && (
          <FieldsFormEditor
            structure={asFields(structure)}
            mode={preview ? "fill" : "design"}
            onChange={editStructure}
            answers={previewAnswers}
            onAnswer={(key, value) => setPreviewAnswers((current) => ({ ...current, [key]: value }))}
          />
        )}
        <p className="fb-note no-print mt-4">
          {structure.kind === "document" && bandHasContent(asDocument(structure).footer)
            ? "This document prints its own footer. Page, Doc ID, Rev, and date fields fill in when you print."
            : structure.kind === "document" && bandHasContent(asDocument(structure).header)
              ? "This document prints its own header. The standard footer and page numbers still print."
              : structure.kind === "document" && asDocument(structure).showPageNumbers
                ? "Page numbers print at the bottom of each page."
                : "Page numbers print with the shared Print button."}
        </p>
      </Paper>
      <section className="no-print">
        <h2 className="text-sm font-medium">Revision history</h2>
        <ul className="mt-1 divide-y divide-border text-sm" aria-label="Revision history">
          {(revisions.data ?? []).map((row) => (
            <li key={row.id} className="flex flex-wrap gap-x-3 py-1">
              <span className="font-medium">REV {row.revision}</span>
              <span className={row.status === "pending" ? "text-amber-700 dark:text-amber-400" : row.status === "rejected" ? "text-destructive" : "text-muted-foreground"}>
                {row.status === "pending" ? "Pending approval" : row.status === "rejected" ? "Rejected" : "Approved"}
              </span>
              <span className="text-muted-foreground">{formatDateTime(row.createdAt)}</span>
              <span className="text-muted-foreground">{row.savedByName ?? "Unknown"}</span>
              <span className="min-w-0 flex-1">
                {row.description}
                {row.status !== "pending" && row.approvedByName ? (
                  <span className="block text-xs text-muted-foreground">
                    {row.status === "approved" && row.approvalSignature ? `Approved: ${row.approvalSignature}` : `${row.status === "rejected" ? "Rejected" : "Approved"} by ${row.approvedByName}${row.approvedAt ? ` on ${formatDateTime(row.approvedAt)}` : ""}`}{row.decisionNote ? `: ${row.decisionNote}` : ""}
                  </span>
                ) : null}
              </span>
            </li>
          ))}
          {(revisions.data ?? []).length === 0 ? <li className="py-1 text-muted-foreground">No saved revision yet. Autosave keeps the draft at REV {form.data.revision}.</li> : null}
        </ul>
      </section>
      {revisionOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => setRevisionOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="revision-title">
            <h2 id="revision-title" className="text-sm font-medium">Submit a new revision for approval</h2>
            <p className="mt-1 text-sm text-muted-foreground">This form is live. A change to it needs a new revision and a note about what changed, then someone with approval permission approves it. Until then fillers open the current version, and copies already filled keep the revision they were opened with.</p>
            <RevisionFields current={form.data.revision} newRevision={newRevision} description={changeDescription} onNewRevision={setNewRevision} onDescription={setChangeDescription} />
            <div className="mt-3 flex gap-2">
              <button type="button" className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50" disabled={!revisionReady || save.isPending} onClick={() => save.mutate({ mode: "save", newRevision: newRevision.trim(), changeDescription: changeDescription.trim() })}>Submit for approval</button>
              <button type="button" className="text-sm text-primary" onClick={() => setRevisionOpen(false)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {decision && form.data.pendingRevisionId != null && (
        <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => setDecision(null)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="decision-title">
            <h2 id="decision-title" className="text-sm font-medium">{decision === "approve" ? `Approve REV ${pending}` : `Reject REV ${pending}`}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {decision === "approve" ? "Fillers will open this revision once you approve it." : "The live version stays as it is. Say why, so the author knows what to fix."}
            </p>
            <label className="mt-3 block text-sm">
              {decision === "approve" ? "Note (optional)" : "Note (required)"}
              <textarea className="mt-1 h-20 w-full rounded border border-border bg-background px-2 py-1" value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} />
            </label>
            {decision === "approve" ? <ApprovalSignatureFields pin={approvalPin} certified={approvalCertified} onPin={setApprovalPin} onCertified={setApprovalCertified} /> : null}
            {decision === "reject" && decisionNote.trim() === "" ? <p role="alert" className="text-xs text-destructive">Enter a note explaining why this revision is rejected.</p> : null}
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
                disabled={decide.isPending || (decision === "reject" ? decisionNote.trim() === "" : !approvalReady(approvalPin, approvalCertified))}
                onClick={() => decide.mutate({ kind: decision, revId: form.data.pendingRevisionId!, note: decisionNote.trim() })}
              >
                {decision === "approve" ? "Sign and approve" : "Reject"}
              </button>
              <button type="button" className="text-sm text-primary" onClick={() => setDecision(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}
      {publishOpen && (
        <div className="no-print fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-6" onClick={() => setPublishOpen(false)}>
          <div className="w-full max-w-md rounded-lg border border-border bg-card p-4 shadow-xl" onClick={(event) => event.stopPropagation()} role="dialog" aria-labelledby="publish-title">
            <h2 id="publish-title" className="text-sm font-medium">{draft ? "Publish blank template" : "Publish this change"}</h2>
            <p className="mt-1 text-sm text-muted-foreground">Choose Blank Forms Templates, or a folder under it. The blank goes live once it is approved, and it stays blank when someone fills a copy.</p>
            {revisionNeeded ? <RevisionFields current={form.data.revision} newRevision={newRevision} description={changeDescription} onNewRevision={setNewRevision} onDescription={setChangeDescription} /> : null}
            <ul className="mt-3 max-h-64 overflow-auto text-sm">
              {blankFolders.map((folder) => (
                <li key={folder.id}>
                  <button type="button" className="w-full rounded px-2 py-1 text-left hover:bg-muted" disabled={publish.isPending || (revisionNeeded && !revisionReady)} onClick={() => publish.mutate(folder.id)}>
                    {folder.name}
                  </button>
                </li>
              ))}
              {blankFolders.length === 0 ? <li className="text-muted-foreground">Blank Forms Templates is not in Documents yet. Open Folder Explorer once, then publish again.</li> : null}
            </ul>
            <button type="button" className="mt-3 text-sm text-primary" onClick={() => setPublishOpen(false)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
