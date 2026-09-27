import { lazy, Suspense, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import { onlyOfficeEditorConfigured, peekOnlyOfficeEditorConfigured, type OfficeSource } from "../../api/onlyoffice";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { OFFICE_PREVIEW_BYTE_LIMIT, officePreviewRoute, officePreviewTooLarge, onlyOfficeFile, previewKind, type OfficePreviewRoute } from "../../lib/filePreview";
import { PdfViewer } from "../forms/PdfViewer";
import { OnlyOfficeEditor } from "../documents/OnlyOfficeEditor";

const DocxPreviewPane = lazy(() => import("./DocxPreviewPane").then((mod) => ({ default: mod.DocxPreviewPane })));
const SpreadsheetPreviewPane = lazy(() => import("./SpreadsheetPreviewPane").then((mod) => ({ default: mod.SpreadsheetPreviewPane })));

export interface PreviewRequest {
  fileName: string;
  mimeType?: string | null;
  /** Known size, when the list already has it, so a large file can show a notice without being parsed. */
  byteSize?: number | null;
  loadBytes: () => Promise<ArrayBuffer>;
  officeSource?: OfficeSource;
  download: () => Promise<void>;
}

/**
 * One preview for every attachment list: an image, a PDF, or Word/Excel/PowerPoint.
 * Word, Excel, and PowerPoint use ONLYOFFICE when that server is configured, and a
 * read-only browser preview when it is not. Download stays available.
 */
export function InAppFilePreview({ request, onClose }: { request: PreviewRequest | null; onClose: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [officeBytes, setOfficeBytes] = useState<ArrayBuffer | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [tooLarge, setTooLarge] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [onlyOfficeOn, setOnlyOfficeOn] = useState<boolean | null>(null);

  const askOnlyOffice = Boolean(request && request.officeSource && onlyOfficeFile(request.fileName, request.mimeType));
  const knownEditor = peekOnlyOfficeEditorConfigured();
  const editorOn = !askOnlyOffice ? false : knownEditor !== null ? knownEditor : onlyOfficeOn === true;
  const waitingForEditor = askOnlyOffice && knownEditor === null && onlyOfficeOn === null;

  useEffect(() => {
    if (!request || !askOnlyOffice) {
      setOnlyOfficeOn(false);
      return;
    }
    let cancelled = false;
    void onlyOfficeEditorConfigured().then((on) => {
      if (!cancelled) setOnlyOfficeOn(on);
    });
    return () => {
      cancelled = true;
    };
  }, [request, askOnlyOffice]);

  const route: OfficePreviewRoute | null = request && !waitingForEditor ? officePreviewRoute(request.fileName, request.mimeType, editorOn) : null;

  useEffect(() => {
    setBytes(null);
    setOfficeBytes(null);
    setImageUrl(null);
    setError(null);
    setTooLarge(false);
    setLoading(false);
  }, [request]);

  useEffect(() => {
    if (!request || waitingForEditor || (editorOn && request.officeSource)) return;
    const kind = previewKind(request.fileName, request.mimeType);
    const wantsOfficeBytes = route === "docx" || route === "sheet";
    const wantsBytes = kind === "image" || kind === "pdf" || wantsOfficeBytes;
    if (!wantsBytes) return;
    if (wantsOfficeBytes && officePreviewTooLarge(request.byteSize)) {
      setTooLarge(true);
      setLoading(false);
      return;
    }
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setTooLarge(false);
    setBytes(null);
    setOfficeBytes(null);
    setImageUrl(null);
    void request
      .loadBytes()
      .then((buf) => {
        if (cancelled) return;
        if (wantsOfficeBytes && buf.byteLength > OFFICE_PREVIEW_BYTE_LIMIT) {
          setTooLarge(true);
          return;
        }
        const mime = (request.mimeType ?? "").toLowerCase();
        const name = request.fileName.toLowerCase();
        if (route === "docx" || route === "sheet") {
          setOfficeBytes(buf.slice(0));
          return;
        }
        if (mime === "application/pdf" || name.endsWith(".pdf")) {
          setBytes(new Uint8Array(buf));
          return;
        }
        objectUrl = URL.createObjectURL(new Blob([buf], { type: request.mimeType || "image/*" }));
        setImageUrl(objectUrl);
      })
      .catch(async (err) => {
        if (!cancelled) setError(await extractErrorMessageAsync(err, "Couldn't open that file."));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [request, waitingForEditor, editorOn, route]);

  useEffect(() => {
    if (!request) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  if (!request) return null;

  if (editorOn && request.officeSource) {
    return <OnlyOfficeEditor fileName={request.fileName} source={request.officeSource} onClose={onClose} onDownload={() => void request.download()} />;
  }

  async function download() {
    if (!request) return;
    setDownloading(true);
    try {
      await request.download();
    } catch (err) {
      setError(await extractErrorMessageAsync(err, "Couldn't download that file."));
    } finally {
      setDownloading(false);
    }
  }

  const showPptx = route === "pptx";

  return createPortal(
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={request.fileName}>
      <div className="flex h-[100dvh] w-full flex-col bg-background text-foreground sm:h-auto sm:max-h-[90vh] sm:max-w-5xl sm:rounded-xl sm:border sm:border-border sm:shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <h2 className="min-w-0 flex-1 truncate text-sm font-medium">{request.fileName}</h2>
          <button type="button" onClick={() => void download()} disabled={downloading} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border px-3 text-sm hover:bg-muted disabled:opacity-60">
            <Download size={16} /> {downloading ? "Downloading…" : "Download"}
          </button>
          <button type="button" onClick={onClose} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border hover:bg-muted" aria-label="Close">
            <X size={16} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-muted/40 p-3">
          {(loading || waitingForEditor) && <p className="text-sm text-muted-foreground">Opening preview…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {tooLarge && (
            <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-8">
              <p className="text-sm">This file is over 15 MB, so it isn't previewed in the browser. Download it to open the full file.</p>
              <button type="button" onClick={() => void download()} disabled={downloading} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm hover:bg-muted disabled:opacity-60">
                <Download size={16} /> {downloading ? "Downloading…" : "Download"}
              </button>
            </div>
          )}
          {showPptx && !loading && (
            <div className="mx-auto flex max-w-md flex-col items-start gap-3 py-8">
              <p className="text-sm">Preview not available, download to view.</p>
              <button type="button" onClick={() => void download()} disabled={downloading} className="inline-flex min-h-11 items-center gap-1 rounded-md border border-border bg-background px-3 text-sm hover:bg-muted disabled:opacity-60">
                <Download size={16} /> {downloading ? "Downloading…" : "Download"}
              </button>
            </div>
          )}
          {!loading && imageUrl && <img src={imageUrl} alt={request.fileName} className="mx-auto max-h-[75dvh] max-w-full rounded-md border border-border bg-background object-contain" />}
          {!loading && bytes && <PdfViewer data={bytes} isLoading={false} />}
          {!loading && !tooLarge && officeBytes && route === "docx" && (
            <Suspense fallback={<p className="text-sm text-muted-foreground">Opening preview…</p>}>
              <DocxPreviewPane data={officeBytes} />
            </Suspense>
          )}
          {!loading && !tooLarge && officeBytes && route === "sheet" && (
            <Suspense fallback={<p className="text-sm text-muted-foreground">Opening preview…</p>}>
              <SpreadsheetPreviewPane data={officeBytes} fileName={request.fileName} />
            </Suspense>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
