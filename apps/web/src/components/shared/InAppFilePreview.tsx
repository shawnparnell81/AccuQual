import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Download, X } from "lucide-react";
import type { OfficeSource } from "../../api/onlyoffice";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { PdfViewer } from "../forms/PdfViewer";
import { OnlyOfficeEditor } from "../documents/OnlyOfficeEditor";

export interface PreviewRequest {
  fileName: string;
  mimeType?: string | null;
  loadBytes: () => Promise<ArrayBuffer>;
  officeSource?: OfficeSource;
  download: () => Promise<void>;
}

/**
 * One preview for every attachment list: an image, a PDF, or Word/Excel/PowerPoint
 * in the office viewer. Download stays available. The caller only opens this for
 * types that can be previewed.
 */
export function InAppFilePreview({ request, onClose }: { request: PreviewRequest | null; onClose: () => void }) {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  useEffect(() => {
    if (!request || request.officeSource) return;
    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBytes(null);
    setImageUrl(null);
    void request
      .loadBytes()
      .then((buf) => {
        if (cancelled) return;
        const mime = (request.mimeType ?? "").toLowerCase();
        const name = request.fileName.toLowerCase();
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
  }, [request]);

  useEffect(() => {
    if (!request) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [request, onClose]);

  if (!request) return null;

  if (request.officeSource) {
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
          {loading && <p className="text-sm text-muted-foreground">Opening preview…</p>}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!loading && imageUrl && <img src={imageUrl} alt={request.fileName} className="mx-auto max-h-[75dvh] max-w-full rounded-md border border-border bg-background object-contain" />}
          {!loading && bytes && <PdfViewer data={bytes} isLoading={false} />}
        </div>
      </div>
    </div>,
    document.body,
  );
}
