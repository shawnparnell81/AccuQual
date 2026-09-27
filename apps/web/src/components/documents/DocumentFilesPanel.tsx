import { useRef, useState } from "react";
import { Download, FileText, Pencil, Trash2, Upload } from "lucide-react";
import { ACCEPTED_FILES, fetchDocumentAttachment, formatBytes, removeAttachment, uploadAttachment, type DocumentAttachmentRef, type DocumentVersion } from "../../api/documents";
import { isOfficeFileName } from "../../api/onlyoffice";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { FileDropZone } from "../shared/FileDropZone";
import { InAppFilePreview, type PreviewRequest } from "../shared/InAppFilePreview";
import { onlyOfficeFile, previewKind, saveBytes } from "../../lib/filePreview";
import { OnlyOfficeEditor } from "./OnlyOfficeEditor";

interface Props {
  documentId: number;
  versionId: number;
  files: DocumentAttachmentRef[];
  editable: boolean;
  /** Called after an upload or removal with the draft as the server now holds it, so the editor can adopt its file list. */
  onChanged: (version: DocumentVersion | null) => void;
  /** Saves any unsaved text first, so the server's copy of the draft is current when the file list changes. */
  flush?: () => Promise<void>;
}

/** The files carried by one revision. Files can be added or removed only while it is a draft; downloads use a short-lived signed link. */
export function DocumentFilesPanel({ documentId, versionId, files, editable, onChanged, flush }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [officeFile, setOfficeFile] = useState<DocumentAttachmentRef | null>(null);
  const [preview, setPreview] = useState<PreviewRequest | null>(null);
  const toast = useToast();

  async function downloadFile(f: DocumentAttachmentRef) {
    const got = await fetchDocumentAttachment(documentId, versionId, f.id);
    saveBytes(got.bytes, got.fileName || f.fileName, got.mimeType);
  }

  function openFile(f: DocumentAttachmentRef) {
    const kind = previewKind(f.fileName, f.mimeType);
    if (kind === "download") {
      void downloadFile(f).catch((err) => toast.error(extractErrorMessage(err, "Couldn't download that file.")));
      return;
    }
    setPreview({
      fileName: f.fileName,
      mimeType: f.mimeType,
      byteSize: f.sizeBytes,
      loadBytes: async () => (await fetchDocumentAttachment(documentId, versionId, f.id)).bytes,
      officeSource: onlyOfficeFile(f.fileName, f.mimeType) ? { kind: "document", documentId, versionId, fileId: f.id, viewOnly: true } : undefined,
      download: () => downloadFile(f),
    });
  }

  async function add(list: FileList | File[] | null) {
    if (!list || list.length === 0) return;
    setBusy(true);
    try {
      await flush?.();
      for (const file of Array.from(list)) {
        const res = await uploadAttachment(documentId, versionId, file);
        onChanged(res.version);
      }
      toast.success(list.length === 1 ? "File attached." : `${list.length} files attached.`);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't attach that file."));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  }

  async function remove(f: DocumentAttachmentRef) {
    if (!confirm(`Remove "${f.fileName}" from this draft? Earlier revisions keep their copy.`)) return;
    setBusy(true);
    try {
      await flush?.();
      await removeAttachment(documentId, versionId, f.id);
      onChanged(null);
    } catch (err) {
      toast.error(extractErrorMessage(err, "Couldn't remove that file."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <FileDropZone className="flex flex-col gap-3" disabled={!editable || busy} accept={ACCEPTED_FILES} label="Drop to attach to this revision" onFiles={(dropped) => void add(dropped)}>
      {files.length === 0 ? (
        <p className="text-sm text-muted-foreground">No files attached to this revision.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {files.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-3 rounded-md border border-border p-2 text-sm">
              <FileText size={16} className="shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <button type="button" onClick={() => openFile(f)} className="block max-w-full truncate text-left font-medium hover:underline">
                  {f.fileName}
                </button>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(f.sizeBytes)} · checksum <code title={f.sha256}>{f.sha256.slice(0, 12)}</code>
                </p>
              </div>
              {editable && isOfficeFileName(f.fileName) && (
                <button
                  type="button"
                  onClick={() => {
                    void Promise.resolve(flush?.())
                      .then(() => setOfficeFile(f))
                      .catch((err) => toast.error(extractErrorMessage(err, "Couldn't open that file.")));
                  }}
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <Pencil size={13} /> Edit
                </button>
              )}
              <button type="button" onClick={() => void downloadFile(f).catch((err) => toast.error(extractErrorMessage(err, "Couldn't download that file.")))} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                <Download size={13} /> Download
              </button>
              {editable && (
                <button disabled={busy} onClick={() => void remove(f)} className="inline-flex items-center gap-1 text-xs text-destructive hover:underline disabled:opacity-50" aria-label={`Remove ${f.fileName}`}>
                  <Trash2 size={13} /> Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <div>
          <input ref={input} type="file" multiple accept={ACCEPTED_FILES} className="hidden" onChange={(e) => void add(e.target.files)} />
          <button disabled={busy} onClick={() => input.current?.click()} className="inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60">
            <Upload size={14} /> {busy ? "Working…" : "Attach files"}
          </button>
          <p className="mt-1 text-xs text-muted-foreground">PDF, Word (.docx), Excel (.xlsx) or an image, up to 15 MB each. Word and Excel preview in the browser, and can open in the editor while this server has ONLYOFFICE configured. Each file's checksum is recorded so the released revision can prove what it held.</p>
        </div>
      )}
      <InAppFilePreview request={preview} onClose={() => setPreview(null)} />
      {officeFile && (
        <OnlyOfficeEditor
          documentId={documentId}
          versionId={versionId}
          fileId={officeFile.id}
          fileName={officeFile.fileName}
          onClose={() => {
            setOfficeFile(null);
            onChanged(null);
          }}
        />
      )}
    </FileDropZone>
  );
}
