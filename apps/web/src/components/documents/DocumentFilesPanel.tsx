import { useRef, useState } from "react";
import { Download, FileText, Pencil, Trash2, Upload } from "lucide-react";
import { ACCEPTED_FILES, formatBytes, openAttachment, removeAttachment, uploadAttachment, type DocumentAttachmentRef, type DocumentVersion } from "../../api/documents";
import { isOfficeFileName } from "../../api/onlyoffice";
import { useToast } from "../shared/ToastProvider";
import { extractErrorMessage } from "../../hooks/useWorkflowAction";
import { FileDropZone } from "../shared/FileDropZone";
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
  const toast = useToast();

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
                <p className="truncate font-medium">{f.fileName}</p>
                <p className="text-xs text-muted-foreground">
                  {formatBytes(f.sizeBytes)} · checksum <code title={f.sha256}>{f.sha256.slice(0, 12)}</code>
                </p>
              </div>
              {isOfficeFileName(f.fileName) && (
                <button
                  type="button"
                  onClick={() => {
                    void Promise.resolve(flush?.())
                      .then(() => setOfficeFile(f))
                      .catch((err) => toast.error(extractErrorMessage(err, "Couldn't open that file.")));
                  }}
                  className="inline-flex items-center gap-1 text-xs text-accent hover:underline"
                >
                  <Pencil size={13} /> {editable ? "Edit" : "View"}
                </button>
              )}
              <button onClick={() => void openAttachment(documentId, versionId, f.id).catch((err) => toast.error(extractErrorMessage(err, "Couldn't open that file.")))} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                <Download size={13} /> Open
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
          <p className="mt-1 text-xs text-muted-foreground">PDF, Word (.docx), Excel (.xlsx) or an image, up to 15 MB each. Word and Excel files can open in the editor while this server has ONLYOFFICE configured. Each file's checksum is recorded so the released revision can prove what it held.</p>
        </div>
      )}
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
