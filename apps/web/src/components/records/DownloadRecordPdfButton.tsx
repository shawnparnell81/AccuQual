import { useState } from "react";
import { FileDown } from "lucide-react";
import { useLocation } from "react-router-dom";
import { apiClient } from "../../api/client";
import { useEffectivePermissions } from "../../hooks/useEffectivePermissions";
import { canPrintAccess, isPdfBytes, PRINT_NOT_DOCUMENT } from "../../lib/printDocument";
import { recordPdfSource, type RecordPdfSource } from "../../lib/recordPdf";
import { captureSheetLayout, findPdfSheet } from "../../lib/sheetLayout";
import { draftKey } from "../../lib/sectionKeepAlive";
import { useDirtyPathStore } from "../../store/dirtyPathStore";
import { recordSurface } from "../../lib/recordSurface";
import { extractErrorMessageAsync } from "../../hooks/useWorkflowAction";
import { useToast } from "../shared/ToastProvider";

const UNSAVED = "Save your changes first; the PDF shows the saved copy.";

/**
 * Download PDF beside Print for records the API can render. Anyone who can
 * view the record can download it, the same rule as Print. It works while
 * the record is locked.
 */
export function DownloadRecordPdfButton({ source: given, allowed, beforeDownload, onDownloaded }: {
  /** A page that renders the button itself passes its source; otherwise the address picks it. */
  source?: RecordPdfSource;
  /** The page already knows the person can view the record (its own access rule); skip the surface check. */
  allowed?: boolean;
  /** Return false to stop, for example when the page has unsaved changes. */
  beforeDownload?: () => boolean;
  onDownloaded?: () => void;
} = {}) {
  const { pathname } = useLocation();
  const toast = useToast();
  const { effective, isLoading } = useEffectivePermissions();
  const [busy, setBusy] = useState(false);
  const source = given ?? recordPdfSource(pathname);
  if (!source) return null;
  const surface = recordSurface(pathname);
  const level = !surface || surface.access === "any" ? "any" : effective?.[surface.access];
  if (allowed === false) return null;
  if (allowed === undefined && !isLoading && !canPrintAccess(level)) return null;

  async function download() {
    if (!source) return;
    if (beforeDownload && !beforeDownload()) return;
    setBusy(true);
    try {
      let layout: unknown = null;
      if (source.method === "layout") {
        const key = draftKey(pathname);
        const dirty = Object.keys(useDirtyPathStore.getState().paths).some((path) => path === key || path.startsWith(`${key}#`));
        if (dirty) throw new Error(UNSAVED);
        const sheet = findPdfSheet();
        if (!sheet) throw new Error("This form isn't on screen yet. Wait for it to load, then try again.");
        layout = await captureSheetLayout(sheet);
      }
      const response = source.method !== "get"
        ? await apiClient.post(source.url, layout, { responseType: "arraybuffer" })
        : await apiClient.get(source.url, { responseType: "arraybuffer" });
      const bytes = new Uint8Array(response.data as ArrayBuffer);
      if (!isPdfBytes(bytes)) throw new Error(PRINT_NOT_DOCUMENT);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
      const link = document.createElement("a");
      link.href = url;
      const disposition = String(response.headers?.["content-disposition"] ?? "");
      link.download = /filename="([^"]+)"/.exec(disposition)?.[1] ?? source.fileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      onDownloaded?.();
    } catch (err) {
      toast.error(err instanceof Error && (err.message === PRINT_NOT_DOCUMENT || err.message === UNSAVED || err.message.startsWith("This form isn't")) ? err.message : await extractErrorMessageAsync(err, "Couldn't download this PDF."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      data-testid="download-record-pdf"
      data-lock-exempt
      disabled={busy}
      onClick={download}
      className="no-print inline-flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm hover:bg-muted disabled:opacity-60"
    >
      <FileDown size={16} /> {busy ? "Preparing…" : "Download PDF"}
    </button>
  );
}
