import { useRef, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { faiValidationDocumentsHref, LEGACY_VALIDATION_REPORTS_PATH } from "../../lib/folderBrowse";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, Upload } from "lucide-react";
import { apiClient } from "../../api/client";
import { fetchDocumentAttachment, uploadAttachment, type DocumentPayload } from "../../api/documents";
import type { CurrentState } from "../../api/versioning";
import type { AccuQualDocument } from "../../api/types";
import { DOCUMENT_FOLDER_PAGES, OBSOLETE_ARCHIVE_CATEGORY } from "../../components/layout/sidebarStructure";
import { StatusBadge } from "../../components/tables/StatusBadge";
import { InAppFilePreview, type PreviewRequest } from "../../components/shared/InAppFilePreview";
import { useToast } from "../../components/shared/ToastProvider";
import { canMaintainMasterList } from "../../lib/masterListAccess";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { onlyOfficeFile, previewKind, saveBytes } from "../../lib/filePreview";
import { formatDate } from "../../lib/dates";
import { LoadingPlaceholder } from "../../components/shared/LoadingPlaceholder";
import { TextField } from "../../components/forms/Field";
import { useCurrentUser } from "../../hooks/useAuth";
import { ObsoleteArchiveDialog } from "./ObsoleteArchiveDialog";
import { DeleteRecordButton } from "../../components/shared/DeleteRecordButton";

/**
 * A single document folder (Drawings, Master Tool List, Shipping, and the other
 * entries that don't have their own module). Files are real controlled documents
 * in that category, with the same upload and file preview the document
 * library already uses.
 */
export function DocumentCategoryPage() {
  const { category = "" } = useParams();
  const legacyValidation = `/folders/${category}` === LEGACY_VALIDATION_REPORTS_PATH;
  const page = DOCUMENT_FOLDER_PAGES[category];
  const toast = useToast();
  const user = useCurrentUser();
  const canRestore = user?.roleName === "admin" || user?.roleName === "owner";
  const maintainToolList = category === "master-tool-list" && canMaintainMasterList(user);
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [movingId, setMovingId] = useState<number | null>(null);
  const [dialog, setDialog] = useState<{ mode: "archive" | "restore"; doc?: AccuQualDocument; file?: File } | null>(null);
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  const [filter, setFilter] = useState("");
  const isArchive = category === OBSOLETE_ARCHIVE_CATEGORY;

  const documents = useQuery<AccuQualDocument[]>({
    queryKey: ["documents", undefined],
    queryFn: async () => (await apiClient.get<AccuQualDocument[]>("/documents")).data,
    enabled: !!page && !legacyValidation,
  });

  if (!page) {
    return <p className="text-sm text-muted-foreground">This folder isn't part of the menu.</p>;
  }

  const rows = (documents.data ?? []).filter((doc) => (isArchive ? doc.category === category || doc.status === "obsolete" : doc.category === category && doc.status !== "obsolete")) as (AccuQualDocument & { createdAt?: string | null })[];
  const needle = filter.trim().toLowerCase();
  const visible = needle ? rows.filter((doc) => doc.title.toLowerCase().includes(needle)) : rows;

  async function upload(file: File, archiveReason?: string) {
    setBusy(true);
    try {
      const created = await apiClient.post<AccuQualDocument>("/documents", { title: file.name, category });
      const current = await apiClient.get<CurrentState<DocumentPayload>>(`/documents/${created.data.id}/current`);
      const versionId = current.data.open?.id;
      if (!versionId) throw new Error("No draft to attach the file to.");
      await uploadAttachment(created.data.id, versionId, file);
      if (isArchive) {
        await apiClient.post(`/documents/${created.data.id}/move-to-obsolete`, { reason: archiveReason, acknowledged: true, confirmation: file.name });
      }
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success(isArchive ? "File archived." : "File uploaded.");
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't upload that file."));
    } finally {
      setBusy(false);
      setDialog(null);
      if (input.current) input.current.value = "";
    }
  }

  async function moveToArchive(doc: AccuQualDocument, reason: string) {
    setMovingId(doc.id);
    try {
      await apiClient.post(`/documents/${doc.id}/move-to-obsolete`, { reason, acknowledged: true, confirmation: doc.title });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Moved to Obsolete / Archive.");
      setDialog(null);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't move that document."));
    } finally {
      setMovingId(null);
    }
  }

  async function restoreDoc(doc: AccuQualDocument, reason: string) {
    setMovingId(doc.id);
    try {
      await apiClient.post(`/documents/${doc.id}/restore`, { reason, acknowledged: true });
      await queryClient.invalidateQueries({ queryKey: ["documents"] });
      toast.success("Document restored.");
      setDialog(null);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't restore that document."));
    } finally {
      setMovingId(null);
    }
  }

  async function resolveFile(doc: AccuQualDocument) {
    const current = await apiClient.get<CurrentState<DocumentPayload>>(`/documents/${doc.id}/current`);
    const version = current.data.open ?? current.data.published;
    const file = version?.payload?.attachments?.[0];
    if (!version || !file) return null;
    return { versionId: version.id, file };
  }

  async function downloadDoc(doc: AccuQualDocument) {
    const resolved = await resolveFile(doc);
    if (!resolved) {
      toast.error("This document doesn't have a file to download yet.");
      return;
    }
    const got = await fetchDocumentAttachment(doc.id, resolved.versionId, resolved.file.id);
    saveBytes(got.bytes, got.fileName || resolved.file.fileName, got.mimeType);
  }

  async function openPreview(doc: AccuQualDocument) {
    try {
      const resolved = await resolveFile(doc);
      if (!resolved) {
        toast.error("This document doesn't have a file to preview yet.");
        return;
      }
      const { file, versionId } = resolved;
      const kind = previewKind(file.fileName, file.mimeType);
      if (kind === "download") {
        const got = await fetchDocumentAttachment(doc.id, versionId, file.id);
        saveBytes(got.bytes, got.fileName || file.fileName, got.mimeType);
        return;
      }
      setPreview({
        fileName: file.fileName,
        mimeType: file.mimeType,
        byteSize: file.sizeBytes,
        loadBytes: async () => (await fetchDocumentAttachment(doc.id, versionId, file.id)).bytes,
        officeSource: onlyOfficeFile(file.fileName, file.mimeType) ? { kind: "document", documentId: doc.id, versionId, fileId: file.id, viewOnly: true } : undefined,
        download: async () => {
          const got = await fetchDocumentAttachment(doc.id, versionId, file.id);
          saveBytes(got.bytes, got.fileName || file.fileName, got.mimeType);
        },
      });
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't open a preview."));
    }
  }

  if (legacyValidation) {
    return <Navigate to={faiValidationDocumentsHref()} replace />;
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">{page.title}</h1>
          <p className="text-sm text-muted-foreground">{page.blurb}</p>
        </div>
        <div>
          <input
            ref={input}
            type="file"
            className="hidden"
            accept=".pdf,.docx,.xlsx,.png,.jpg,.jpeg,.gif,.webp"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (isArchive) setDialog({ mode: "archive", file });
              else void upload(file);
            }}
          />
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={busy}
            className={`inline-flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium disabled:opacity-60 ${
              page.emphasizeUpload ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"
            }`}
          >
            <Upload size={16} />
            {busy ? "Uploading…" : "Upload"}
          </button>
        </div>
      </div>

      {documents.isLoading && <LoadingPlaceholder />}
      {documents.isError && <p className="text-sm text-destructive">Couldn't load this folder. Refresh the page and try again.</p>}
      {!documents.isLoading && !documents.isError && rows.length === 0 && (
        <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">No files in this folder yet. Use Upload to add one.</div>
      )}

      {rows.length > 0 && (
        <div className="max-w-sm">
          <TextField label="Filter files" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Search by file name" />
        </div>
      )}

      {rows.length > 0 && visible.length === 0 && <p className="text-sm text-muted-foreground">No files match this filter.</p>}

      {visible.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-muted/40 text-xs uppercase tracking-wide text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {visible.map((doc) => (
                <tr key={doc.id} className={`border-t border-border ${doc.status === "obsolete" ? "bg-muted/40" : ""}`}>
                  <td className="px-3 py-2 font-medium">
                    <button type="button" onClick={() => void openPreview(doc)} className="text-left hover:underline">
                      {doc.title}
                    </button>
                    {doc.status === "obsolete" && (
                      <span className="ml-2 align-middle">
                        <StatusBadge value="obsolete" label="Obsolete" />
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{doc.createdAt || doc.updatedAt ? formatDate(doc.createdAt ?? doc.updatedAt) : ""}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {doc.status === "obsolete" ? <StatusBadge value="obsolete" label="Obsolete" /> : <span className="capitalize">{doc.status.replace(/_/g, " ")}</span>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {!isArchive && doc.status !== "obsolete" && (
                      <button type="button" onClick={() => setDialog({ mode: "archive", doc })} disabled={movingId === doc.id} className="mr-3 inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-60">
                        Move to Obsolete / Archive
                      </button>
                    )}
                    {isArchive && canRestore && doc.status === "obsolete" && doc.category === category && (
                      <button type="button" onClick={() => setDialog({ mode: "restore", doc })} disabled={movingId === doc.id} className="mr-3 inline-flex items-center gap-1 text-primary hover:underline disabled:opacity-60">
                        Restore
                      </button>
                    )}
                    <button type="button" onClick={() => void openPreview(doc)} className="mr-3 inline-flex items-center gap-1 text-primary hover:underline">
                      <Eye size={14} /> Preview
                    </button>
                    <button type="button" onClick={() => void downloadDoc(doc).catch((err) => toast.error(extractErrorMessage(err, "Couldn't download that file.")))} className="mr-3 inline-flex items-center gap-1 text-primary hover:underline">
                      <Download size={14} /> Download
                    </button>
                    {maintainToolList && (
                      <Link to={`/documents/${doc.id}`} className="mr-3 text-primary hover:underline">Edit</Link>
                    )}
                    <DeleteRecordButton
                      resource="documents"
                      id={doc.id}
                      kind="Document"
                      title={doc.title}
                      ownerIds={[doc.ownerId]}
                      allowed={maintainToolList}
                      label={maintainToolList ? "Remove" : "Delete"}
                      className="inline-flex items-center text-destructive hover:underline disabled:opacity-60"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <InAppFilePreview request={preview} onClose={() => setPreview(null)} />
      {dialog && (
        <ObsoleteArchiveDialog
          open
          mode={dialog.mode}
          documentId={dialog.doc?.id}
          documentTitle={dialog.doc?.title ?? dialog.file?.name ?? ""}
          busy={busy || movingId != null}
          onClose={() => {
            setDialog(null);
            if (input.current) input.current.value = "";
          }}
          onConfirm={(reason) => {
            if (dialog.mode === "restore" && dialog.doc) void restoreDoc(dialog.doc, reason);
            else if (dialog.file) void upload(dialog.file, reason);
            else if (dialog.doc) void moveToArchive(dialog.doc, reason);
          }}
        />
      )}
    </div>
  );
}
